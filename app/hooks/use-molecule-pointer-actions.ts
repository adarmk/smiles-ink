import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { getCanvasBounds } from "../lib/dom";
import {
  angleFromCenter,
  clampPosition,
  computeResize,
  oppositeCornerOffset,
  shortestAngleDelta,
  type ResizeStart,
} from "../lib/geometry";
import type {
  CanvasTransform,
  MoleculeItem,
  ResizeDirection,
} from "../lib/types";

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
  | ({
      kind: "resize";
      id: string;
      pointerId: number;
      startX: number;
      startY: number;
    } & ResizeStart)
  | {
      kind: "rotate";
      id: string;
      pointerId: number;
      centerX: number;
      centerY: number;
      lastAngle: number;
      rotation: number;
    };

type Options = {
  canvasTransformRef: RefObject<CanvasTransform>;
  updateMolecule: (id: string, update: Partial<MoleculeItem>) => void;
  bringForward: (id: string) => void;
};

/** Drag to move, corner handles to resize, and the arc handle to rotate. */
export function useMoleculePointerActions({
  canvasTransformRef,
  updateMolecule,
  bringForward,
}: Options) {
  const actionRef = useRef<PointerAction | null>(null);

  const finishPointerAction = useCallback((pointerId?: number) => {
    const action = actionRef.current;
    if (action && (pointerId === undefined || action.pointerId === pointerId)) {
      actionRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointerEnd = (event: PointerEvent) =>
      finishPointerAction(event.pointerId);
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
    actionRef.current = {
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
    const oppositeCorner = oppositeCornerOffset(
      direction,
      molecule.width,
      molecule.height,
      molecule.rotation,
    );
    actionRef.current = {
      kind: "resize",
      id: molecule.id,
      pointerId: event.pointerId,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      width: molecule.width,
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
    const moleculeElement =
      event.currentTarget.closest<HTMLElement>(".molecule-item");
    if (!moleculeElement) return;

    const bounds = moleculeElement.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    bringForward(molecule.id);
    actionRef.current = {
      kind: "rotate",
      id: molecule.id,
      pointerId: event.pointerId,
      centerX,
      centerY,
      lastAngle: angleFromCenter(event.clientX, event.clientY, centerX, centerY),
      rotation: molecule.rotation,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const action = actionRef.current;
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
      actionRef.current = { ...action, lastAngle: currentAngle, rotation };
      updateMolecule(action.id, {
        rotation: event.shiftKey ? Math.round(rotation / 15) * 15 : rotation,
      });
      return;
    }

    const transform = canvasTransformRef.current;
    const deltaX = (event.clientX - action.startX) / transform.scale;
    const deltaY = (event.clientY - action.startY) / transform.scale;

    if (action.kind === "drag") {
      const bounds = getCanvasBounds(action.width / action.height, transform);
      updateMolecule(
        action.id,
        clampPosition(
          action.x + deltaX,
          action.y + deltaY,
          action.width,
          action.height,
          bounds,
        ),
      );
      return;
    }

    updateMolecule(
      action.id,
      computeResize(
        action,
        deltaX,
        deltaY,
        getCanvasBounds(action.ratio, transform),
      ),
    );
  };

  return {
    startDrag,
    startResize,
    startRotation,
    handlePointerMove,
    finishPointerAction,
  };
}
