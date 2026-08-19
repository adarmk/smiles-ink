"use client";

import type { JSMol, RDKitModule } from "@rdkit/rdkit";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { makeSmilesCandidates, splitSmilesInput } from "./smiles-cleanup";

type MoleculeItem = {
  id: string;
  smiles: string;
  canonicalSmiles: string;
  svg: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
};

type ResizeDirection = "nw" | "ne" | "sw" | "se";
type Theme = "light" | "dark";
type CanvasTransform = { x: number; y: number; scale: number };
type TouchPoint = { x: number; y: number };
type CanvasGesture =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
    }
  | {
      kind: "pinch";
      startDistance: number;
      startScale: number;
      worldX: number;
      worldY: number;
    };

const THEME_STORAGE_KEY = "drawchem-theme";
const THEME_CHANGE_EVENT = "drawchem:theme-change";
const INITIAL_CANVAS_TRANSFORM: CanvasTransform = { x: 0, y: 0, scale: 1 };
const MIN_CANVAS_SCALE = 0.6;
const MAX_CANVAS_SCALE = 2.8;

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function subscribeToTheme(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = () => onStoreChange();
  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    try {
      if (localStorage.getItem(THEME_STORAGE_KEY)) return;
    } catch {
      // Continue following the system theme when storage is unavailable.
    }
    document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    onStoreChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  mediaQuery.addEventListener("change", handleSystemThemeChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    mediaQuery.removeEventListener("change", handleSystemThemeChange);
  };
}

type PointerAction =
  | {
      kind: "drag";
      id: string;
      pointerId: number;
      startX: number;
      startY: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "resize";
      id: string;
      pointerId: number;
      direction: ResizeDirection;
      startX: number;
      startY: number;
      width: number;
      height: number;
      ratio: number;
      rotation: number;
      anchorX: number;
      anchorY: number;
    }
  | {
      kind: "rotate";
      id: string;
      pointerId: number;
      centerX: number;
      centerY: number;
      lastAngle: number;
      rotation: number;
    };

declare global {
  interface Window {
    __drawchemRDKit?: RDKitModule;
  }
}

let rdkitPromise: Promise<RDKitModule> | null = null;

function loadRDKit(): Promise<RDKitModule> {
  if (window.__drawchemRDKit) return Promise.resolve(window.__drawchemRDKit);
  if (rdkitPromise) return rdkitPromise;

  rdkitPromise = new Promise<RDKitModule>((resolve, reject) => {
    const initialize = async () => {
      try {
        const rdkitInstance = await window.initRDKitModule({
          locateFile: () => "/rdkit/RDKit_minimal.wasm",
        });
        rdkitInstance.prefer_coordgen(true);
        window.__drawchemRDKit = rdkitInstance;
        resolve(rdkitInstance);
      } catch (error) {
        rdkitPromise = null;
        reject(error);
      }
    };

    const loader = (
      window as unknown as {
        initRDKitModule?: Window["initRDKitModule"];
      }
    ).initRDKitModule;
    if (typeof loader === "function") {
      void initialize();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-drawchem-rdkit]",
    );
    const script = existing ?? document.createElement("script");
    const handleLoad = () => void initialize();
    const handleError = () => {
      rdkitPromise = null;
      reject(new Error("RDKit failed to load"));
    };

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existing) {
      script.src = "/rdkit/RDKit_minimal.js";
      script.async = true;
      script.dataset.drawchemRdkit = "true";
      document.head.appendChild(script);
    }
  });

  return rdkitPromise;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function angleFromCenter(
  clientX: number,
  clientY: number,
  centerX: number,
  centerY: number,
) {
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
}

function shortestAngleDelta(delta: number) {
  return ((delta + 540) % 360) - 180;
}

function rotateVector(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function resizeCursor(direction: ResizeDirection, rotation: number) {
  const baseAngle = direction === "nw" || direction === "se" ? 45 : 135;
  const angle = ((baseAngle + rotation) % 180 + 180) % 180;
  const cursors = [
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
  ] as const;
  return cursors[Math.round(angle / 45) % cursors.length];
}

function getCanvasBounds(
  ratio = 1.5,
  transform: CanvasTransform = INITIAL_CANVAS_TRANSFORM,
) {
  const stage = document.querySelector<HTMLElement>(".canvas-stage");
  const dock = Array.from(
    document.querySelectorAll<HTMLElement>(".canvas-dock"),
  ).find((element) => element.getClientRects().length > 0);
  const stageRect = stage?.getBoundingClientRect();
  const width = stageRect?.width ?? window.innerWidth;
  const height = stageRect?.height ?? window.innerHeight;
  const scale = transform.scale;
  const isCompact = width <= 680 || height <= 500;
  const sidePadding = isCompact ? 24 : 12;
  const top = isCompact ? 70 : 48;
  const dockTop =
    stageRect && dock
      ? dock.getBoundingClientRect().top - stageRect.top
      : height - (isCompact ? 118 : 92);
  const bottom = Math.max(
    top + 108,
    Math.min(height - 12, dockTop - (isCompact ? 42 : 34)),
  );
  const minWidth = (isCompact ? 160 : 220) / scale;
  const horizontalMaximum = Math.max(
    minWidth,
    (width - sidePadding * 2) / scale,
  );
  const verticalMaximum = Math.max(
    minWidth,
    ((bottom - top) * ratio) / scale,
  );

  return {
    left: (sidePadding - transform.x) / scale,
    right: (width - sidePadding - transform.x) / scale,
    top: (top - transform.y) / scale,
    bottom: (bottom - transform.y) / scale,
    minWidth,
    maxWidth: Math.max(
      minWidth,
      Math.min(
        isCompact ? horizontalMaximum : 820,
        horizontalMaximum,
        verticalMaximum,
      ),
    ),
  };
}

function isTextEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable ||
      target.closest("[contenteditable='true']") !== null)
  );
}

function cleanSvg(svgSource: string) {
  const documentNode = new DOMParser().parseFromString(
    svgSource,
    "image/svg+xml",
  );
  const svg = documentNode.documentElement;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg.outerHTML;
}

function depictSmiles(rdkit: RDKitModule, smiles: string) {
  for (const candidate of makeSmilesCandidates(smiles)) {
    let molecule: JSMol | null = null;

    try {
      molecule = rdkit.get_mol(candidate.value);
      if (!molecule || !molecule.is_valid()) continue;

      molecule.set_new_coords(true);
      const svg = molecule.get_svg_with_highlights(
        JSON.stringify({
          width: 720,
          height: 480,
          clearBackground: false,
          centreMoleculesBeforeDrawing: true,
          padding: 0.025,
          bondLineWidth: 1.8,
          multipleBondOffset: 0.16,
          minFontSize: 14,
          maxFontSize: 34,
          annotationFontScale: 0.72,
          addStereoAnnotation: true,
          includeRadicals: true,
          explicitMethyl: false,
        }),
      );

      if (!svg) continue;
      return {
        smiles: candidate.value,
        fixes: candidate.fixes,
        canonicalSmiles: molecule.get_smiles(),
        svg: cleanSvg(svg),
      };
    } catch {
      continue;
    } finally {
      molecule?.delete();
    }
  }

  return null;
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Home() {
  const [molecules, setMolecules] = useState<MoleculeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );
  const [rendererStatus, setRendererStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [isRendering, setIsRendering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"neutral" | "error">("neutral");
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(
    INITIAL_CANVAS_TRANSFORM,
  );
  const rdkitRef = useRef<RDKitModule | null>(null);
  const pointerActionRef = useRef<PointerAction | null>(null);
  const canvasTransformRef = useRef<CanvasTransform>(INITIAL_CANVAS_TRANSFORM);
  const canvasGestureRef = useRef<CanvasGesture | null>(null);
  const touchPointsRef = useRef(new Map<number, TouchPoint>());
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasSizeRef = useRef<{ width: number; height: number } | null>(null);

  const applyCanvasTransform = useCallback((next: CanvasTransform) => {
    canvasTransformRef.current = next;
    setCanvasTransform(next);
  }, []);

  const showNotice = useCallback(
    (message: string, tone: "neutral" | "error" = "neutral") => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      setNoticeTone(tone);
      setNotice(message);
      noticeTimerRef.current = setTimeout(() => setNotice(null), 3200);
    },
    [],
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = getThemeSnapshot() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for this session.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRDKit()
      .then((module) => {
        if (cancelled) return;
        rdkitRef.current = module;
        setRendererStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setRendererStatus("error");
        showNotice("The local renderer could not start.", "error");
      });

    return () => {
      cancelled = true;
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, [showNotice]);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let animationFrame = 0;
    const syncVisualViewport = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        root.style.setProperty(
          "--visual-viewport-height",
          `${viewport?.height ?? window.innerHeight}px`,
        );
        root.style.setProperty(
          "--visual-viewport-offset-top",
          `${viewport?.offsetTop ?? 0}px`,
        );
      });
    };

    syncVisualViewport();
    window.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("resize", syncVisualViewport);
    viewport?.addEventListener("scroll", syncVisualViewport);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("resize", syncVisualViewport);
      viewport?.removeEventListener("scroll", syncVisualViewport);
    };
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const readCanvasSize = () => {
      const stage = document.querySelector<HTMLElement>(".canvas-stage");
      return {
        width: stage?.clientWidth ?? window.innerWidth,
        height: stage?.clientHeight ?? window.innerHeight,
      };
    };
    canvasSizeRef.current = readCanvasSize();
    const keepMoleculesInView = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const previousSize = canvasSizeRef.current;
        const nextSize = readCanvasSize();
        canvasSizeRef.current = nextSize;
        const widthChanged =
          !previousSize || Math.abs(previousSize.width - nextSize.width) > 1;
        if (isTextEditingTarget(document.activeElement) && !widthChanged) return;
        setMolecules((current) => {
          let changed = false;
          const next = current.map((molecule) => {
            const ratio = molecule.width / molecule.height;
            const bounds = getCanvasBounds(
              ratio,
              canvasTransformRef.current,
            );
            const width = Math.min(molecule.width, bounds.maxWidth);
            const height = width / ratio;
            const x = clamp(
              molecule.x,
              bounds.left,
              Math.max(bounds.left, bounds.right - width),
            );
            const y = clamp(
              molecule.y,
              bounds.top,
              Math.max(bounds.top, bounds.bottom - height),
            );
            if (
              width === molecule.width &&
              height === molecule.height &&
              x === molecule.x &&
              y === molecule.y
            ) {
              return molecule;
            }
            changed = true;
            return { ...molecule, width, height, x, y };
          });
          return changed ? next : current;
        });
      });
    };

    window.addEventListener("resize", keepMoleculesInView);
    window.addEventListener("orientationchange", keepMoleculesInView);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", keepMoleculesInView);
      window.removeEventListener("orientationchange", keepMoleculesInView);
    };
  }, []);

  const addSmiles = useCallback(
    async (rawValue: string) => {
      const entries = splitSmilesInput(rawValue);
      if (!entries.length || isRendering) return;

      setIsRendering(true);
      try {
        const rdkit = rdkitRef.current ?? (await loadRDKit());
        rdkitRef.current = rdkit;
        setRendererStatus("ready");

        const rendered = entries
          .map((smiles) => {
            const depiction = depictSmiles(rdkit, smiles);
            return depiction ? { ...depiction, id: makeId() } : null;
          })
          .filter(
            (
              item,
            ): item is {
              smiles: string;
              canonicalSmiles: string;
              svg: string;
              fixes: string[];
              id: string;
            } => item !== null,
          );

        const invalidCount = entries.length - rendered.length;
        const repairedCount = rendered.filter((item) => item.fixes.length > 0).length;
        if (!rendered.length) {
          showNotice("That doesn’t look like valid SMILES.", "error");
          return;
        }

        const lastId = rendered[rendered.length - 1].id;
        setMolecules((current) => {
          const ratio = 1 / 0.67;
          const bounds = getCanvasBounds(ratio, canvasTransformRef.current);
          const next = rendered.map((item, index) => {
            const complexity = item.canonicalSmiles.length;
            const preferredWidth = clamp(340 + complexity * 2.4, 380, 620);
            const width = Math.min(preferredWidth, bounds.maxWidth);
            const height = width / ratio;
            const cascade = ((current.length + index) % 6) * 26;
            const x = clamp(
              (bounds.left + bounds.right - width) / 2 + cascade,
              bounds.left,
              Math.max(bounds.left, bounds.right - width),
            );
            const y = clamp(
              (bounds.top + bounds.bottom - height) / 2 + cascade * 0.4,
              bounds.top,
              Math.max(bounds.top, bounds.bottom - height),
            );

            return {
              ...item,
              x,
              y,
              width,
              height,
              rotation: 0,
              zIndex: current.length + index + 1,
            };
          });
          return [...current, ...next];
        });

        setSelectedId(lastId);
        setInput("");
        if (invalidCount) {
          showNotice(
            `${rendered.length} rendered${repairedCount ? ` · ${repairedCount} cleaned` : ""} · ${invalidCount} skipped`,
            "error",
          );
        } else if (repairedCount) {
          showNotice(
            rendered.length === 1
              ? "Cleaned up and rendered"
              : `${repairedCount} cleaned · ${rendered.length} rendered`,
          );
        } else {
          showNotice(
            rendered.length === 1
              ? "Molecule added"
              : `${rendered.length} molecules added`,
          );
        }
      } catch {
        setRendererStatus("error");
        showNotice("The local renderer could not start.", "error");
      } finally {
        setIsRendering(false);
      }
    },
    [isRendering, showNotice],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      const pasted = event.clipboardData?.getData("text").trim();
      if (!pasted) return;
      event.preventDefault();
      setInput(pasted);
      void addSmiles(pasted);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addSmiles]);

  const updateMolecule = useCallback(
    (id: string, update: Partial<MoleculeItem>) => {
      setMolecules((current) =>
        current.map((molecule) =>
          molecule.id === id ? { ...molecule, ...update } : molecule,
        ),
      );
    },
    [],
  );

  const bringForward = useCallback((id: string) => {
    setSelectedId(id);
    setMolecules((current) => {
      const topLayer = current.reduce(
        (highest, molecule) => Math.max(highest, molecule.zIndex),
        0,
      );
      return current.map((molecule) =>
        molecule.id === id
          ? { ...molecule, zIndex: topLayer + 1 }
          : molecule,
      );
    });
  }, []);

  const removeMolecule = useCallback((id: string) => {
    setMolecules((current) => current.filter((molecule) => molecule.id !== id));
    setSelectedId((selected) => (selected === id ? null : selected));
  }, []);

  const clearCanvas = useCallback(() => {
    setMolecules([]);
    setSelectedId(null);
    applyCanvasTransform(INITIAL_CANVAS_TRANSFORM);
    showNotice("Canvas cleared");
  }, [applyCanvasTransform, showNotice]);

  const pasteFromClipboard = useCallback(async () => {
    if (isRendering || rendererStatus === "error") return;
    try {
      const pasted = (await navigator.clipboard.readText()).trim();
      if (!pasted) {
        showNotice("Your clipboard is empty.", "error");
        return;
      }
      await addSmiles(pasted);
    } catch {
      showNotice("Allow clipboard access, then try Paste again.", "error");
    }
  }, [addSmiles, isRendering, rendererStatus, showNotice]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEditingTarget(event.target)) return;

      if (
        molecules.length > 0 &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "x"
      ) {
        event.preventDefault();
        clearCanvas();
        return;
      }

      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selectedId) return;

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeMolecule(selectedId);
        return;
      }

      const movement: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = movement[event.key];
      if (!delta) return;
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 2) / canvasTransformRef.current.scale;
      setMolecules((current) =>
        current.map((molecule) =>
          molecule.id === selectedId
            ? {
                ...molecule,
                x: molecule.x + delta[0] * step,
                y: molecule.y + delta[1] * step,
              }
            : molecule,
        ),
      );
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clearCanvas, molecules.length, removeMolecule, selectedId]);

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    molecule: MoleculeItem,
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest(".selection-toolbar") ||
      target.closest(".resize-handle") ||
      target.closest(".rotation-handle")
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    bringForward(molecule.id);
    pointerActionRef.current = {
      kind: "drag",
      id: molecule.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: molecule.x,
      y: molecule.y,
      width: molecule.width,
      height: molecule.height,
    };
  };

  const startResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    molecule: MoleculeItem,
    direction: ResizeDirection,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    bringForward(molecule.id);
    const signX = direction.includes("e") ? 1 : -1;
    const signY = direction.includes("s") ? 1 : -1;
    const oppositeCorner = rotateVector(
      (-signX * molecule.width) / 2,
      (-signY * molecule.height) / 2,
      molecule.rotation,
    );
    pointerActionRef.current = {
      kind: "resize",
      id: molecule.id,
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      width: molecule.width,
      height: molecule.height,
      ratio: molecule.width / molecule.height,
      rotation: molecule.rotation,
      anchorX: molecule.x + molecule.width / 2 + oppositeCorner.x,
      anchorY: molecule.y + molecule.height / 2 + oppositeCorner.y,
    };
  };

  const startRotation = (
    event: ReactPointerEvent<HTMLSpanElement>,
    molecule: MoleculeItem,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const moleculeElement = event.currentTarget.closest<HTMLElement>(
      ".molecule-item",
    );
    if (!moleculeElement) return;

    const bounds = moleculeElement.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    bringForward(molecule.id);
    pointerActionRef.current = {
      kind: "rotate",
      id: molecule.id,
      pointerId: event.pointerId,
      centerX,
      centerY,
      lastAngle: angleFromCenter(
        event.clientX,
        event.clientY,
        centerX,
        centerY,
      ),
      rotation: molecule.rotation,
    };
  };

  const rotateWithKeyboard = (
    event: ReactKeyboardEvent<HTMLSpanElement>,
    molecule: MoleculeItem,
  ) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (!direction && event.key !== "Home") return;
    event.preventDefault();
    updateMolecule(molecule.id, {
      rotation: event.key === "Home" ? 0 : molecule.rotation + direction * 15,
    });
  };

  const finishPointerAction = useCallback((pointerId?: number) => {
    const action = pointerActionRef.current;
    if (action && (pointerId === undefined || action.pointerId === pointerId)) {
      pointerActionRef.current = null;
    }
  }, []);

  const finishCanvasGesture = useCallback((pointerId?: number) => {
    if (pointerId === undefined) {
      touchPointsRef.current.clear();
      canvasGestureRef.current = null;
      return;
    }

    touchPointsRef.current.delete(pointerId);
    const gesture = canvasGestureRef.current;
    if (
      (gesture?.kind === "pan" && gesture.pointerId === pointerId) ||
      (gesture?.kind === "pinch" && touchPointsRef.current.size < 2)
    ) {
      canvasGestureRef.current = null;
    }
  }, []);

  const handleCanvasPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.pointerType !== "touch") {
      if (event.target === event.currentTarget) setSelectedId(null);
      return;
    }

    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (touchPointsRef.current.size >= 2) {
      event.preventDefault();
      pointerActionRef.current = null;
      const [first, second] = Array.from(touchPointsRef.current.values());
      const stageRect = event.currentTarget.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - stageRect.left;
      const centerY = (first.y + second.y) / 2 - stageRect.top;
      const transform = canvasTransformRef.current;
      canvasGestureRef.current = {
        kind: "pinch",
        startDistance: Math.max(
          1,
          Math.hypot(second.x - first.x, second.y - first.y),
        ),
        startScale: transform.scale,
        worldX: (centerX - transform.x) / transform.scale,
        worldY: (centerY - transform.y) / transform.scale,
      };
      setSelectedId(null);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The other pointer may already own capture on a molecule.
      }
      return;
    }

    if (event.target === event.currentTarget) {
      event.preventDefault();
      const transform = canvasTransformRef.current;
      canvasGestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: transform.x,
        y: transform.y,
      };
      setSelectedId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handleCanvasPointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.pointerType !== "touch") return;
    if (touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    const gesture = canvasGestureRef.current;
    if (gesture?.kind === "pinch" && touchPointsRef.current.size >= 2) {
      event.preventDefault();
      const [first, second] = Array.from(touchPointsRef.current.values());
      const stageRect = event.currentTarget.getBoundingClientRect();
      const centerX = (first.x + second.x) / 2 - stageRect.left;
      const centerY = (first.y + second.y) / 2 - stageRect.top;
      const distance = Math.max(
        1,
        Math.hypot(second.x - first.x, second.y - first.y),
      );
      const scale = clamp(
        gesture.startScale * (distance / gesture.startDistance),
        MIN_CANVAS_SCALE,
        MAX_CANVAS_SCALE,
      );
      applyCanvasTransform({
        scale,
        x: centerX - gesture.worldX * scale,
        y: centerY - gesture.worldY * scale,
      });
      return;
    }

    if (
      gesture?.kind === "pan" &&
      gesture.pointerId === event.pointerId
    ) {
      event.preventDefault();
      applyCanvasTransform({
        scale: canvasTransformRef.current.scale,
        x: gesture.x + event.clientX - gesture.startX,
        y: gesture.y + event.clientY - gesture.startY,
      });
    }
  };

  useEffect(() => {
    const handlePointerEnd = (event: PointerEvent) => {
      finishPointerAction(event.pointerId);
      finishCanvasGesture(event.pointerId);
    };
    const handleWindowBlur = () => {
      finishPointerAction();
      finishCanvasGesture();
    };

    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [finishCanvasGesture, finishPointerAction]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = pointerActionRef.current;
    if (!action || action.pointerId !== event.pointerId) return;

    // Pointer capture can occasionally be lost during a React re-render. A
    // mouse move with no pressed buttons must never continue an old gesture.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishPointerAction(event.pointerId);
      return;
    }

    if (action.kind === "rotate") {
      const currentAngle = angleFromCenter(
        event.clientX,
        event.clientY,
        action.centerX,
        action.centerY,
      );
      const rotation =
        action.rotation + shortestAngleDelta(currentAngle - action.lastAngle);
      pointerActionRef.current = {
        ...action,
        lastAngle: currentAngle,
        rotation,
      };
      updateMolecule(action.id, {
        rotation: event.shiftKey ? Math.round(rotation / 15) * 15 : rotation,
      });
      return;
    }

    const scale = canvasTransformRef.current.scale;
    const deltaX = (event.clientX - action.startX) / scale;
    const deltaY = (event.clientY - action.startY) / scale;

    if (action.kind === "drag") {
      const bounds = getCanvasBounds(
        action.width / action.height,
        canvasTransformRef.current,
      );
      updateMolecule(action.id, {
        x: clamp(
          action.x + deltaX,
          bounds.left,
          Math.max(bounds.left, bounds.right - action.width),
        ),
        y: clamp(
          action.y + deltaY,
          bounds.top,
          Math.max(bounds.top, bounds.bottom - action.height),
        ),
      });
      return;
    }

    const signX = action.direction.includes("e") ? 1 : -1;
    const signY = action.direction.includes("s") ? 1 : -1;
    const localDelta = rotateVector(deltaX, deltaY, -action.rotation);
    const projectedWidthFromX = action.width + localDelta.x * signX;
    const projectedWidthFromY =
      action.width + localDelta.y * signY * action.ratio;
    const bounds = getCanvasBounds(
      action.ratio,
      canvasTransformRef.current,
    );
    const width = clamp(
      Math.abs(localDelta.x) > Math.abs(localDelta.y)
        ? projectedWidthFromX
        : projectedWidthFromY,
      bounds.minWidth,
      bounds.maxWidth,
    );
    const height = width / action.ratio;
    const centerOffset = rotateVector(
      (signX * width) / 2,
      (signY * height) / 2,
      action.rotation,
    );
    const centerX = action.anchorX + centerOffset.x;
    const centerY = action.anchorY + centerOffset.y;
    const x = clamp(
      centerX - width / 2,
      bounds.left,
      Math.max(bounds.left, bounds.right - width),
    );
    const y = clamp(
      centerY - height / 2,
      bounds.top,
      Math.max(bounds.top, bounds.bottom - height),
    );

    updateMolecule(action.id, { x, y, width, height });
  };

  const handleInputPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;
    event.preventDefault();
    setInput(pasted);
    void addSmiles(pasted);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="smiles.ink">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">smiles.ink</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-subtitle">SMILES canvas</span>
        </div>

        <div className="topbar-actions">
          <a
            className="x-link"
            href="https://x.com/adarkahiri"
            target="_blank"
            rel="noreferrer"
            title="@adarkahiri on X"
            aria-label="Follow @adarkahiri on X"
          >
            <span className="x-mark" aria-hidden="true">
              𝕏
            </span>
          </a>
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
          {molecules.length > 0 && (
            <button
              className="clear-button"
              type="button"
              onClick={clearCanvas}
              title="Clear canvas (⌘X)"
              aria-keyshortcuts="Meta+X Control+X"
            >
              <span className="clear-label">Clear canvas</span>
              <span className="clear-icon" aria-hidden="true">
                ×
              </span>
              <kbd aria-hidden="true">⌘X</kbd>
            </button>
          )}
        </div>
      </header>

      <section
        className="canvas-stage"
        aria-label="Molecule canvas"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={(event) => finishCanvasGesture(event.pointerId)}
        onPointerCancel={(event) => finishCanvasGesture(event.pointerId)}
      >
        <div
          className="canvas-viewport"
          style={{
            transform: `translate3d(${canvasTransform.x}px, ${canvasTransform.y}px, 0) scale(${canvasTransform.scale})`,
          }}
        >
          {molecules.length === 0 && (
            <div className="empty-state" aria-hidden="true">
              <div className="empty-orbit">
                <span />
                <span />
                <span />
              </div>
              <p>Paste a SMILES string</p>
              <span className="desktop-hint">
                ⌘V anywhere, or use the field below
              </span>
              <span className="mobile-hint">
                Tap Paste below · drag to pan · pinch to zoom
              </span>
            </div>
          )}

          {molecules.map((molecule) => {
          const isSelected = selectedId === molecule.id;
          const displayedRotation =
            ((Math.round(molecule.rotation) % 360) + 360) % 360;
          const radians = (molecule.rotation * Math.PI) / 180;
          const rotatedHeight =
            Math.abs(molecule.width * Math.sin(radians)) +
            Math.abs(molecule.height * Math.cos(radians));
          const toolbarTop = (molecule.height - rotatedHeight) / 2 - 48;
          const labelTop = (molecule.height + rotatedHeight) / 2 + 10;
            return (
              <div
              className={`molecule-item${isSelected ? " is-selected" : ""}`}
              key={molecule.id}
              style={{
                left: molecule.x,
                top: molecule.y,
                width: molecule.width,
                height: molecule.height,
                zIndex: molecule.zIndex,
              }}
              role="group"
              aria-label={`Molecule ${molecule.canonicalSmiles}`}
              onPointerDown={(event) => startDrag(event, molecule)}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => finishPointerAction(event.pointerId)}
              onPointerCancel={(event) => finishPointerAction(event.pointerId)}
              onLostPointerCapture={(event) =>
                finishPointerAction(event.pointerId)
              }
            >
              <div
                className="molecule-transform"
                style={{ transform: `rotate(${molecule.rotation}deg)` }}
              >
                <div className="molecule-art">
                  <div
                    className="molecule-svg"
                    dangerouslySetInnerHTML={{ __html: molecule.svg }}
                  />
                </div>

                {isSelected && (
                  <>
                    {(["nw", "ne", "sw", "se"] as ResizeDirection[]).map(
                      (direction) => (
                        <span
                          className={`resize-handle resize-handle--${direction}`}
                          key={direction}
                          role="presentation"
                          style={{
                            cursor: resizeCursor(direction, molecule.rotation),
                          }}
                          onPointerDown={(event) =>
                            startResize(event, molecule, direction)
                          }
                          onLostPointerCapture={(event) =>
                            finishPointerAction(event.pointerId)
                          }
                        />
                      ),
                    )}
                    <span
                      className="rotation-handle"
                      role="presentation"
                      aria-hidden="true"
                      title="Drag to rotate · hold Shift to snap"
                      onPointerDown={(event) =>
                        startRotation(event, molecule)
                      }
                      onLostPointerCapture={(event) =>
                        finishPointerAction(event.pointerId)
                      }
                    />
                  </>
                )}
              </div>

              {isSelected && (
                <>
                  <div
                    className="selection-toolbar"
                    role="toolbar"
                    aria-label="Molecule controls"
                    style={{ top: toolbarTop }}
                  >
                    <span
                      className="rotation-value"
                      role="slider"
                      tabIndex={0}
                      aria-label="Molecule rotation"
                      aria-valuemin={0}
                      aria-valuemax={359}
                      aria-valuenow={displayedRotation}
                      aria-valuetext={`${displayedRotation} degrees`}
                      title="Rotation · use arrow keys or drag the rotation handle"
                      onKeyDown={(event) =>
                        rotateWithKeyboard(event, molecule)
                      }
                    >
                      {displayedRotation}°
                    </span>
                    <span className="toolbar-divider" aria-hidden="true" />
                    <button
                      className="delete-button"
                      type="button"
                      title="Delete molecule"
                      aria-label="Delete molecule"
                      onClick={() => removeMolecule(molecule.id)}
                    >
                      ×
                    </button>
                  </div>

                  <div
                    className="smiles-label"
                    title={molecule.canonicalSmiles}
                    style={{ top: labelTop }}
                  >
                    {molecule.canonicalSmiles}
                  </div>
                </>
              )}
              </div>
            );
          })}
        </div>
      </section>

      <form
        className="smiles-dock canvas-dock"
        onSubmit={(event) => {
          event.preventDefault();
          void addSmiles(input);
        }}
      >
        <div className="input-kicker">
          <span>SMILES</span>
          <span>
            {molecules.length
              ? `${molecules.length} on canvas · auto-clean on`
              : "auto-clean on"}
          </span>
        </div>
        <div className="input-row">
          <span className="input-plus" aria-hidden="true">
            +
          </span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={handleInputPaste}
            placeholder="Paste SMILES — spaces & line breaks are okay…"
            aria-label="SMILES string"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            className="render-button"
            type="submit"
            aria-label={
              isRendering ? "Rendering molecule" : "Render molecule"
            }
            disabled={!input.trim() || isRendering || rendererStatus === "error"}
          >
            <span>{isRendering ? "Rendering" : "Render"}</span>
            <span className="return-symbol" aria-hidden="true">
              ↵
            </span>
          </button>
        </div>
      </form>

      <div
        className="mobile-action-dock canvas-dock"
        role="group"
        aria-label="Canvas actions"
      >
        <button
          className="mobile-action-button mobile-paste-button"
          type="button"
          aria-label={
            isRendering ? "Rendering molecule" : "Paste SMILES from clipboard"
          }
          onClick={() => void pasteFromClipboard()}
          disabled={isRendering || rendererStatus === "error"}
        >
          <span aria-hidden="true">↧</span>
        </button>
        <button
          className="mobile-action-button mobile-clear-button"
          type="button"
          aria-label="Clear canvas"
          onClick={clearCanvas}
          disabled={molecules.length === 0}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {notice && (
        <div
          className={`notice notice--${noticeTone}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">{noticeTone === "error" ? "!" : "✓"}</span>
          {notice}
        </div>
      )}

      <div className="canvas-help" aria-hidden="true">
        Drag to move&nbsp;&nbsp;·&nbsp;&nbsp;Corners resize&nbsp;&nbsp;·&nbsp;&nbsp;Arc handle rotates&nbsp;&nbsp;·&nbsp;&nbsp;Delete removes&nbsp;&nbsp;·&nbsp;&nbsp;⌘X clears
      </div>
    </main>
  );
}
