import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampCanvasScale,
  INITIAL_CANVAS_TRANSFORM,
  wheelScale,
  zoomAround,
} from "../lib/geometry";
import type { CanvasTransform } from "../lib/types";

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

/**
 * Pan (drag empty canvas), wheel/trackpad zoom, and two-finger pinch zoom.
 * `onGestureStart` fires when a pan or pinch begins so the page can clear
 * selection and abandon any molecule interaction.
 */
export function useCanvasViewport(
  stageRef: RefObject<HTMLElement | null>,
  onGestureStart: (kind: CanvasGesture["kind"]) => void,
) {
  const [canvasTransform, setCanvasTransform] = useState<CanvasTransform>(
    INITIAL_CANVAS_TRANSFORM,
  );
  const canvasTransformRef = useRef<CanvasTransform>(INITIAL_CANVAS_TRANSFORM);
  const gestureRef = useRef<CanvasGesture | null>(null);
  const touchPointsRef = useRef(new Map<number, TouchPoint>());

  const applyCanvasTransform = useCallback((next: CanvasTransform) => {
    canvasTransformRef.current = next;
    setCanvasTransform(next);
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      const stageRect = stage.getBoundingClientRect();
      const delta =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * stageRect.height
            : event.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;

      event.preventDefault();
      const transform = canvasTransformRef.current;
      applyCanvasTransform(
        zoomAround(
          transform,
          event.clientX - stageRect.left,
          event.clientY - stageRect.top,
          wheelScale(transform.scale, delta),
        ),
      );
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [applyCanvasTransform, stageRef]);

  const finishCanvasGesture = useCallback((pointerId?: number) => {
    if (pointerId === undefined) {
      touchPointsRef.current.clear();
      gestureRef.current = null;
      return;
    }

    touchPointsRef.current.delete(pointerId);
    const gesture = gestureRef.current;
    if (
      (gesture?.kind === "pan" && gesture.pointerId === pointerId) ||
      (gesture?.kind === "pinch" && touchPointsRef.current.size < 2)
    ) {
      gestureRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handlePointerEnd = (event: PointerEvent) =>
      finishCanvasGesture(event.pointerId);
    const handleWindowBlur = () => finishCanvasGesture();

    window.addEventListener("pointerup", handlePointerEnd, true);
    window.addEventListener("pointercancel", handlePointerEnd, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd, true);
      window.removeEventListener("pointercancel", handlePointerEnd, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [finishCanvasGesture]);

  const startPan = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const transform = canvasTransformRef.current;
    gestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: transform.x,
      y: transform.y,
    };
    onGestureStart("pan");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const pinchCenter = (stage: HTMLElement) => {
    const [first, second] = Array.from(touchPointsRef.current.values());
    const stageRect = stage.getBoundingClientRect();
    return {
      x: (first.x + second.x) / 2 - stageRect.left,
      y: (first.y + second.y) / 2 - stageRect.top,
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const isBackground = event.target === event.currentTarget;

    if (event.pointerType !== "touch") {
      if (isBackground && event.button === 0) startPan(event);
      return;
    }

    touchPointsRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (touchPointsRef.current.size >= 2) {
      event.preventDefault();
      const center = pinchCenter(event.currentTarget);
      const transform = canvasTransformRef.current;
      gestureRef.current = {
        kind: "pinch",
        startDistance: center.distance,
        startScale: transform.scale,
        worldX: (center.x - transform.x) / transform.scale,
        worldY: (center.y - transform.y) / transform.scale,
      };
      onGestureStart("pinch");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The other pointer may already own capture on a molecule.
      }
      return;
    }

    if (isBackground) startPan(event);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.kind === "pan" && gesture.pointerId === event.pointerId) {
      event.preventDefault();
      applyCanvasTransform({
        scale: canvasTransformRef.current.scale,
        x: gesture.x + event.clientX - gesture.startX,
        y: gesture.y + event.clientY - gesture.startY,
      });
      return;
    }

    if (event.pointerType !== "touch") return;
    if (touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    }

    if (gesture?.kind === "pinch" && touchPointsRef.current.size >= 2) {
      event.preventDefault();
      const center = pinchCenter(event.currentTarget);
      // Anchor the world point that started under the fingers to their
      // current midpoint, so pinching also pans.
      const scale = clampCanvasScale(
        gesture.startScale * (center.distance / gesture.startDistance),
      );
      applyCanvasTransform({
        scale,
        x: center.x - gesture.worldX * scale,
        y: center.y - gesture.worldY * scale,
      });
    }
  };

  return {
    canvasTransform,
    canvasTransformRef,
    applyCanvasTransform,
    finishCanvasGesture,
    stageHandlers: {
      onPointerDown: handleCanvasPointerDown,
      onPointerMove: handleCanvasPointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) =>
        finishCanvasGesture(event.pointerId),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) =>
        finishCanvasGesture(event.pointerId),
    },
  };
}
