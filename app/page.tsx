"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoleculeCard } from "./components/molecule-card";
import { MobileActionDock, SmilesInputDock } from "./components/smiles-docks";
import { Topbar } from "./components/topbar";
import { useCanvasPersistence } from "./hooks/use-canvas-persistence";
import { useCanvasViewport } from "./hooks/use-canvas-viewport";
import { useMoleculePointerActions } from "./hooks/use-molecule-pointer-actions";
import { useNotice } from "./hooks/use-notice";
import { useVisualViewportVars } from "./hooks/use-visual-viewport-vars";
import {
  getCanvasBounds,
  hasSelectedTextInEditor,
  isTextEditingTarget,
  makeId,
} from "./lib/dom";
import {
  fitBoxToBounds,
  INITIAL_CANVAS_TRANSFORM,
  MOLECULE_ASPECT_RATIO,
  placeNewMolecule,
} from "./lib/geometry";
import { renderSmiles, whenRendererReady } from "./lib/renderer";
import { useTheme } from "./lib/theme";
import type { MoleculeItem } from "./lib/types";
import { splitSmilesInput } from "./smiles-cleanup";

const ARROW_KEY_MOVEMENT: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export default function Home() {
  const [molecules, setMolecules] = useState<MoleculeItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [rendererStatus, setRendererStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [isRendering, setIsRendering] = useState(false);
  const canvasStageRef = useRef<HTMLElement | null>(null);

  const { theme, toggleTheme } = useTheme();
  const { notice, noticeTone, showNotice } = useNotice();
  useVisualViewportVars();

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
        molecule.id === id ? { ...molecule, zIndex: topLayer + 1 } : molecule,
      );
    });
  }, []);

  const finishPointerActionRef = useRef<(pointerId?: number) => void>(
    () => {},
  );
  const handleCanvasGestureStart = useCallback((kind: "pan" | "pinch") => {
    setSelectedId(null);
    // A second finger turns any molecule drag into a canvas pinch.
    if (kind === "pinch") finishPointerActionRef.current();
  }, []);

  const {
    canvasTransform,
    canvasTransformRef,
    applyCanvasTransform,
    stageHandlers,
  } = useCanvasViewport(canvasStageRef, handleCanvasGestureStart);

  const pointerActions = useMoleculePointerActions({
    canvasTransformRef,
    updateMolecule,
    bringForward,
  });
  useEffect(() => {
    finishPointerActionRef.current = pointerActions.finishPointerAction;
  }, [pointerActions.finishPointerAction]);

  const { isInitializing } = useCanvasPersistence({
    molecules,
    setMolecules,
    canvasTransform,
    applyCanvasTransform,
    showNotice,
  });

  useEffect(() => {
    let cancelled = false;
    whenRendererReady()
      .then(() => {
        if (!cancelled) setRendererStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setRendererStatus("error");
        showNotice("The local renderer could not start.", "error");
      });

    return () => {
      cancelled = true;
    };
  }, [showNotice]);

  // Shrink and nudge molecules back into view when the window resizes.
  useEffect(() => {
    let animationFrame = 0;
    const readStageWidth = () =>
      canvasStageRef.current?.clientWidth ?? window.innerWidth;
    let previousWidth = readStageWidth();

    const keepMoleculesInView = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const nextWidth = readStageWidth();
        const widthChanged = Math.abs(previousWidth - nextWidth) > 1;
        previousWidth = nextWidth;
        // Height-only changes while typing are the mobile keyboard opening.
        if (isTextEditingTarget(document.activeElement) && !widthChanged) return;

        setMolecules((current) => {
          let changed = false;
          const next = current.map((molecule) => {
            const bounds = getCanvasBounds(
              molecule.width / molecule.height,
              canvasTransformRef.current,
            );
            const fitted = fitBoxToBounds(molecule, bounds);
            if (
              fitted.width === molecule.width &&
              fitted.height === molecule.height &&
              fitted.x === molecule.x &&
              fitted.y === molecule.y
            ) {
              return molecule;
            }
            changed = true;
            return { ...molecule, ...fitted };
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
  }, [canvasTransformRef]);

  const addSmiles = useCallback(
    async (rawValue: string) => {
      const entries = splitSmilesInput(rawValue);
      if (!entries.length || isRendering || isInitializing) return;

      setIsRendering(true);
      try {
        const depictions = await Promise.all(
          entries.map((smiles) => renderSmiles(smiles, { stereoLabels: false })),
        );
        setRendererStatus("ready");
        const rendered = depictions.flatMap((depiction) =>
          depiction ? [{ ...depiction, id: makeId() }] : [],
        );

        const invalidCount = entries.length - rendered.length;
        const repairedCount = rendered.filter(
          (item) => item.fixes.length > 0,
        ).length;
        if (!rendered.length) {
          showNotice("That doesn’t look like valid SMILES.", "error");
          return;
        }

        setMolecules((current) => {
          const bounds = getCanvasBounds(
            MOLECULE_ASPECT_RATIO,
            canvasTransformRef.current,
          );
          const topLayer = current.reduce(
            (highest, molecule) => Math.max(highest, molecule.zIndex),
            0,
          );
          const added = rendered.map(
            ({ id, smiles, canonicalSmiles, svg }, index): MoleculeItem => ({
              id,
              smiles,
              canonicalSmiles,
              svg,
              ...placeNewMolecule(
                canonicalSmiles.length,
                current.length + index,
                bounds,
              ),
              rotation: 0,
              flippedHorizontally: false,
              flippedVertically: false,
              stereoLabels: false,
              zIndex: topLayer + index + 1,
            }),
          );
          return [...current, ...added];
        });

        setSelectedId(rendered[rendered.length - 1].id);
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
    [canvasTransformRef, isInitializing, isRendering, showNotice],
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

  const copySmiles = useCallback(
    async (smiles: string) => {
      try {
        await navigator.clipboard.writeText(smiles);
        showNotice("SMILES copied");
      } catch {
        showNotice("Your browser blocked clipboard access.", "error");
      }
    },
    [showNotice],
  );

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (!selectedId || hasSelectedTextInEditor(event.target)) return;
      const selectedMolecule = molecules.find(
        (molecule) => molecule.id === selectedId,
      );
      if (!selectedMolecule || !event.clipboardData) return;

      event.preventDefault();
      event.clipboardData.setData("text/plain", selectedMolecule.canonicalSmiles);
      showNotice("SMILES copied");
    };

    window.addEventListener("copy", handleCopy);
    return () => window.removeEventListener("copy", handleCopy);
  }, [molecules, selectedId, showNotice]);

  const flipMolecule = useCallback(
    (id: string, direction: "horizontal" | "vertical") => {
      setMolecules((current) =>
        current.map((molecule) => {
          if (molecule.id !== id) return molecule;
          return direction === "horizontal"
            ? { ...molecule, flippedHorizontally: !molecule.flippedHorizontally }
            : { ...molecule, flippedVertically: !molecule.flippedVertically };
        }),
      );
    },
    [],
  );

  const toggleStereoLabels = useCallback(
    async (id: string) => {
      const molecule = molecules.find((item) => item.id === id);
      if (!molecule) return;
      const stereoLabels = !molecule.stereoLabels;
      updateMolecule(id, { stereoLabels });
      try {
        // Same SMILES, so the worker reuses the cached layout.
        const depiction = await renderSmiles(molecule.smiles, { stereoLabels });
        if (depiction) updateMolecule(id, { svg: depiction.svg });
      } catch {
        updateMolecule(id, { stereoLabels: molecule.stereoLabels });
        showNotice("The local renderer could not start.", "error");
      }
    },
    [molecules, showNotice, updateMolecule],
  );

  const rotateMolecule = useCallback(
    (id: string, rotation: number) => updateMolecule(id, { rotation }),
    [updateMolecule],
  );

  const pasteFromClipboard = useCallback(async () => {
    if (isInitializing || isRendering || rendererStatus === "error") return;
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
  }, [addSmiles, isInitializing, isRendering, rendererStatus, showNotice]);

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

      const delta = ARROW_KEY_MOVEMENT[event.key];
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
  }, [canvasTransformRef, clearCanvas, molecules.length, removeMolecule, selectedId]);

  const isRendererUnavailable = rendererStatus === "error";

  return (
    <main className="app-shell">
      <Topbar
        theme={theme}
        onToggleTheme={toggleTheme}
        hasMolecules={molecules.length > 0}
        onClear={clearCanvas}
      />

      <section
        ref={canvasStageRef}
        className="canvas-stage"
        aria-label="Molecule canvas"
        {...stageHandlers}
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

          {molecules.map((molecule) => (
            <MoleculeCard
              key={molecule.id}
              molecule={molecule}
              isSelected={selectedId === molecule.id}
              onDragStart={pointerActions.startDrag}
              onResizeStart={pointerActions.startResize}
              onRotationStart={pointerActions.startRotation}
              onPointerMove={pointerActions.handlePointerMove}
              onPointerEnd={pointerActions.finishPointerAction}
              onRotate={rotateMolecule}
              onFlip={flipMolecule}
              onToggleStereoLabels={(id) => void toggleStereoLabels(id)}
              onCopy={(smiles) => void copySmiles(smiles)}
              onRemove={removeMolecule}
            />
          ))}
        </div>
      </section>

      <SmilesInputDock
        value={input}
        onChange={setInput}
        onSubmit={(value) => void addSmiles(value)}
        isRendering={isRendering}
        isDisabled={isInitializing || isRendererUnavailable}
      />

      <MobileActionDock
        onPaste={() => void pasteFromClipboard()}
        onClear={clearCanvas}
        isRendering={isRendering}
        isPasteDisabled={isInitializing || isRendering || isRendererUnavailable}
        isClearDisabled={molecules.length === 0}
      />

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
        Scroll or pinch to zoom&nbsp;&nbsp;·&nbsp;&nbsp;Drag canvas to pan&nbsp;&nbsp;·&nbsp;&nbsp;Drag molecule to move&nbsp;&nbsp;·&nbsp;&nbsp;Corners resize&nbsp;&nbsp;·&nbsp;&nbsp;Arc rotates
      </div>
    </main>
  );
}
