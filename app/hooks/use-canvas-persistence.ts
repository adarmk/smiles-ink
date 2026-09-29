import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { getCanvasBounds } from "../lib/dom";
import { fitBoxToBounds } from "../lib/geometry";
import {
  CANVAS_STORAGE_KEY,
  parseSavedCanvas,
  serializeCanvas,
} from "../lib/persistence";
import { renderSmiles, whenRendererReady } from "../lib/renderer";
import type { CanvasTransform, MoleculeItem } from "../lib/types";

const SAVE_DELAY_MS = 250;

type Options = {
  molecules: MoleculeItem[];
  setMolecules: Dispatch<SetStateAction<MoleculeItem[]>>;
  canvasTransform: CanvasTransform;
  applyCanvasTransform: (transform: CanvasTransform) => void;
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
 * re-rendered from SMILES once the renderer is ready. Nothing is written until the
 * restore has run, so a failed load never overwrites a saved canvas.
 */
export function useCanvasPersistence({
  molecules,
  setMolecules,
  canvasTransform,
  applyCanvasTransform,
}: Options) {
  const [isRestored, setIsRestored] = useState(false);
  const moleculeCountRef = useRef(molecules.length);
  useEffect(() => {
    moleculeCountRef.current = molecules.length;
  });

  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      await whenRendererReady();
      if (cancelled) return;
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
    restore().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [applyCanvasTransform, setMolecules]);

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
}
