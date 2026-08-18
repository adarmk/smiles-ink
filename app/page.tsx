"use client";

import type { JSMol, RDKitModule } from "@rdkit/rdkit";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
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

const THEME_STORAGE_KEY = "drawchem-theme";
const THEME_CHANGE_EVENT = "drawchem:theme-change";

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
      x: number;
      y: number;
      width: number;
      height: number;
      ratio: number;
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
  const rdkitRef = useRef<RDKitModule | null>(null);
  const pointerActionRef = useRef<PointerAction | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const viewportWidth = window.innerWidth;
          const viewportHeight = window.innerHeight;
          const next = rendered.map((item, index) => {
            const complexity = item.canonicalSmiles.length;
            const width = clamp(340 + complexity * 2.4, 380, 620);
            const height = width * 0.67;
            const cascade = ((current.length + index) % 6) * 26;
            const x = clamp(
              viewportWidth / 2 - width / 2 + cascade,
              18,
              Math.max(18, viewportWidth - width - 18),
            );
            const y = clamp(
              viewportHeight / 2 - height / 2 - 34 + cascade * 0.4,
              82,
              Math.max(82, viewportHeight - height - 118),
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
    showNotice("Canvas cleared");
  }, [showNotice]);

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
      const step = event.shiftKey ? 10 : 2;
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
    if (target.closest("button") || target.closest(".resize-handle")) return;
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
    pointerActionRef.current = {
      kind: "resize",
      id: molecule.id,
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      x: molecule.x,
      y: molecule.y,
      width: molecule.width,
      height: molecule.height,
      ratio: molecule.width / molecule.height,
    };
  };

  const finishPointerAction = useCallback((pointerId?: number) => {
    const action = pointerActionRef.current;
    if (action && (pointerId === undefined || action.pointerId === pointerId)) {
      pointerActionRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointerEnd = (event: PointerEvent) => {
      finishPointerAction(event.pointerId);
    };
    const handleWindowBlur = () => finishPointerAction();

    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [finishPointerAction]);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = pointerActionRef.current;
    if (!action || action.pointerId !== event.pointerId) return;

    // Pointer capture can occasionally be lost during a React re-render. A
    // mouse move with no pressed buttons must never continue an old gesture.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishPointerAction(event.pointerId);
      return;
    }

    const deltaX = event.clientX - action.startX;
    const deltaY = event.clientY - action.startY;

    if (action.kind === "drag") {
      updateMolecule(action.id, {
        x: clamp(
          action.x + deltaX,
          12,
          Math.max(12, window.innerWidth - action.width - 12),
        ),
        y: clamp(
          action.y + deltaY,
          68,
          Math.max(68, window.innerHeight - action.height - 92),
        ),
      });
      return;
    }

    const growsRight = action.direction.includes("e");
    const widthDelta = growsRight ? deltaX : -deltaX;
    const projectedWidthFromY =
      action.width + (action.direction.includes("s") ? deltaY : -deltaY) * action.ratio;
    const projectedWidthFromX = action.width + widthDelta;
    const width = clamp(
      Math.abs(widthDelta) > Math.abs(deltaY)
        ? projectedWidthFromX
        : projectedWidthFromY,
      220,
      820,
    );
    const height = width / action.ratio;
    const x = growsRight ? action.x : action.x + action.width - width;
    const y = action.direction.includes("s")
      ? action.y
      : action.y + action.height - height;

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
        <div className="brand" aria-label="Drawchem">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span className="brand-word">drawchem</span>
          <span className="brand-divider" aria-hidden="true" />
          <span className="brand-subtitle">SMILES canvas</span>
        </div>

        <div className="topbar-actions">
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
              <span>Clear canvas</span>
              <kbd aria-hidden="true">⌘X</kbd>
            </button>
          )}
          <div
            className={`renderer-status renderer-status--${rendererStatus}`}
            aria-live="polite"
          >
            <span className="status-dot" aria-hidden="true" />
            {rendererStatus === "loading"
              ? "Starting locally"
              : rendererStatus === "ready"
                ? "RDKit · local"
                : "Renderer offline"}
          </div>
        </div>
      </header>

      <section
        className="canvas-stage"
        aria-label="Molecule canvas"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSelectedId(null);
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
            <span>⌘V anywhere, or use the field below</span>
          </div>
        )}

        {molecules.map((molecule) => {
          const isSelected = selectedId === molecule.id;
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
                className="molecule-art"
                style={{ transform: `rotate(${molecule.rotation}deg)` }}
              >
                <div
                  className="molecule-svg"
                  dangerouslySetInnerHTML={{ __html: molecule.svg }}
                />
              </div>

              {isSelected && (
                <>
                  <div className="selection-toolbar" role="toolbar" aria-label="Molecule controls">
                    <button
                      type="button"
                      title="Rotate left 15°"
                      aria-label="Rotate left 15 degrees"
                      onClick={() =>
                        updateMolecule(molecule.id, {
                          rotation: molecule.rotation - 15,
                        })
                      }
                    >
                      ↶
                    </button>
                    <span className="rotation-value">
                      {((molecule.rotation % 360) + 360) % 360}°
                    </span>
                    <button
                      type="button"
                      title="Rotate right 15°"
                      aria-label="Rotate right 15 degrees"
                      onClick={() =>
                        updateMolecule(molecule.id, {
                          rotation: molecule.rotation + 15,
                        })
                      }
                    >
                      ↷
                    </button>
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

                  {(["nw", "ne", "sw", "se"] as ResizeDirection[]).map(
                    (direction) => (
                      <span
                        className={`resize-handle resize-handle--${direction}`}
                        key={direction}
                        role="presentation"
                        onPointerDown={(event) =>
                          startResize(event, molecule, direction)
                        }
                        onLostPointerCapture={(event) =>
                          finishPointerAction(event.pointerId)
                        }
                      />
                    ),
                  )}
                  <div className="smiles-label" title={molecule.canonicalSmiles}>
                    {molecule.canonicalSmiles}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>

      <form
        className="smiles-dock"
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
            disabled={!input.trim() || isRendering || rendererStatus === "error"}
          >
            <span>{isRendering ? "Rendering" : "Render"}</span>
            <span className="return-symbol" aria-hidden="true">
              ↵
            </span>
          </button>
        </div>
      </form>

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
        Drag to move&nbsp;&nbsp;·&nbsp;&nbsp;Corners to resize&nbsp;&nbsp;·&nbsp;&nbsp;Delete to remove&nbsp;&nbsp;·&nbsp;&nbsp;⌘X to clear
      </div>
    </main>
  );
}
