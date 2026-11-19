import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { parseCanvasUrl, renderCanvasUrl } from "../lib/canvas-url";
import { getCanvasBounds, makeId } from "../lib/dom";
import { fitBoxToBounds, INITIAL_CANVAS_TRANSFORM } from "../lib/geometry";
import {
  CANVAS_STORAGE_KEY,
  parseSavedCanvas,
  serializeCanvas,
} from "../lib/persistence";
import { renderSmiles, whenRendererReady } from "../lib/renderer";
import type { CanvasTransform, MoleculeItem, NoticeTone } from "../lib/types";

const SAVE_DELAY_MS = 250;

type Options = {
  molecules: MoleculeItem[];
  setMolecules: Dispatch<SetStateAction<MoleculeItem[]>>;
  canvasTransform: CanvasTransform;
  applyCanvasTransform: (transform: CanvasTransform) => void;
  showNotice: (message: string, tone?: NoticeTone) => void;
};

function readStorage() {
  try {
    return localStorage.getItem(CANVAS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string) {
  try {
    localStorage.setItem(CANVAS_STORAGE_KEY, value);
  } catch {
    // Storage may be full or disabled; the canvas still works for this visit.
  }
}

/**
 * Keep the canvas in localStorage so it survives reloads. Saved molecules are
 * re-rendered from SMILES once the renderer is ready. A valid URL snapshot takes
 * precedence over storage and is committed atomically, without fitting its boxes.
 * Nothing is written until initialization completes successfully.
 */
export function useCanvasPersistence({
  molecules,
  setMolecules,
  canvasTransform,
  applyCanvasTransform,
  showNotice,
}: Options) {
  const [isRestored, setIsRestored] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const moleculeCountRef = useRef(molecules.length);
  useEffect(() => {
    moleculeCountRef.current = molecules.length;
  });

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      await whenRendererReady();
      if (cancelled) return;
      try {
        const entries = parseCanvasUrl(window.location.search);
        if (entries !== null) {
          const imported = await renderCanvasUrl(entries, renderSmiles, makeId);
          if (cancelled) return;
          applyCanvasTransform(INITIAL_CANVAS_TRANSFORM);
          setMolecules(imported);
          setIsRestored(true);
          showNotice(imported.length
            ? `${imported.length} molecule${imported.length === 1 ? "" : "s"} loaded from URL`
            : "Empty canvas loaded from URL");
          return;
        }
      } catch {
        if (cancelled) return;
        showNotice("Could not load the canvas URL. Your saved canvas has been kept.", "error");
      }
      const saved = parseSavedCanvas(readStorage());
      if (saved?.molecules.length) {
        const rendered = await Promise.all(
          saved.molecules.map((item) =>
            renderSmiles(item.smiles, { stereoLabels: item.stereoLabels }).catch(
              () => null,
            ),
          ),
        );
        if (cancelled) return;

        // Only restore the viewport if the person hasn't started working yet.
        const transform = moleculeCountRef.current === 0 ? saved.transform : null;
        if (transform) applyCanvasTransform(transform);

        const restored = saved.molecules.flatMap((item, index): MoleculeItem[] => {
          const depiction = rendered[index];
          if (!depiction) return [];
          const bounds = getCanvasBounds(
            item.width / item.height,
            transform ?? undefined,
          );
          return [
            {
              ...item,
              ...fitBoxToBounds(item, bounds),
              smiles: depiction.smiles,
              canonicalSmiles: depiction.canonicalSmiles,
              svg: depiction.svg,
            },
          ];
        });

        const topLayer = restored.reduce(
          (highest, item) => Math.max(highest, item.zIndex),
          0,
        );
        setMolecules((current) => [
          ...restored,
          ...current.map((item) => ({
            ...item,
            zIndex: item.zIndex + topLayer,
          })),
        ]);
      }
      setIsRestored(true);
    };

    // If the renderer can't start, the page reports it; the saved canvas is
    // left untouched because saving only begins after a restore.
    restore().catch(() => {}).finally(() => {
      if (!cancelled) setIsInitializing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [applyCanvasTransform, setMolecules, showNotice]);

  const latestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRestored) return;
    latestRef.current = serializeCanvas(molecules, canvasTransform);
    const timer = setTimeout(() => {
      if (latestRef.current) writeStorage(latestRef.current);
      latestRef.current = null;
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [canvasTransform, isRestored, molecules]);

  useEffect(() => {
    const flush = () => {
      if (latestRef.current) writeStorage(latestRef.current);
      latestRef.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return { isInitializing };
}
