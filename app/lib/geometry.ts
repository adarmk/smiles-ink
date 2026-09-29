// Pure canvas math. Kept free of DOM access and runtime imports so it can be
// unit-tested directly with `node --test`.
import type {
  Box,
  CanvasBounds,
  CanvasTransform,
  ResizeDirection,
} from "./types";

export const INITIAL_CANVAS_TRANSFORM: CanvasTransform = { x: 0, y: 0, scale: 1 };
export const MIN_CANVAS_SCALE = 0.6;
export const MAX_CANVAS_SCALE = 2.8;
/** Width / height of every RDKit depiction (720 × 480 SVG, framed tightly). */
export const MOLECULE_ASPECT_RATIO = 1 / 0.67;

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function angleFromCenter(
  clientX: number,
  clientY: number,
  centerX: number,
  centerY: number,
) {
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
}

export function shortestAngleDelta(delta: number) {
  return ((delta + 540) % 360) - 180;
}

export function rotateVector(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}

export function normalizeDegrees(degrees: number) {
  return ((Math.round(degrees) % 360) + 360) % 360;
}

export function resizeCursor(direction: ResizeDirection, rotation: number) {
  const baseAngle = direction === "nw" || direction === "se" ? 45 : 135;
  const angle = (((baseAngle + rotation) % 180) + 180) % 180;
  const cursors = [
    "ew-resize",
    "nwse-resize",
    "ns-resize",
    "nesw-resize",
  ] as const;
  return cursors[Math.round(angle / 45) % cursors.length];
}

export type StageMetrics = {
  width: number;
  height: number;
  /** Distance from the stage top to the visible input dock, if any. */
  dockTop: number | null;
};

/** The world-space area molecules may occupy, clear of the header and dock. */
export function computeCanvasBounds(
  stage: StageMetrics,
  ratio = 1.5,
  transform: CanvasTransform = INITIAL_CANVAS_TRANSFORM,
): CanvasBounds {
  const { width, height } = stage;
  const scale = transform.scale;
  const isCompact = width <= 680 || height <= 500;
  const sidePadding = isCompact ? 24 : 12;
  const top = isCompact ? 70 : 48;
  const dockTop = stage.dockTop ?? height - (isCompact ? 118 : 92);
  const bottom = Math.max(
    top + 108,
    Math.min(height - 12, dockTop - (isCompact ? 42 : 34)),
  );
  const minWidth = (isCompact ? 160 : 220) / scale;
  const horizontalMaximum = Math.max(minWidth, (width - sidePadding * 2) / scale);
  const verticalMaximum = Math.max(minWidth, ((bottom - top) * ratio) / scale);

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

/** Clamp a box's top-left corner so it stays inside the bounds when it fits. */
export function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: CanvasBounds,
) {
  return {
    x: clamp(x, bounds.left, Math.max(bounds.left, bounds.right - width)),
    y: clamp(y, bounds.top, Math.max(bounds.top, bounds.bottom - height)),
  };
}

/** Shrink (never grow) and move a box so it fits the bounds. */
export function fitBoxToBounds(box: Box, bounds: CanvasBounds): Box {
  const ratio = box.width / box.height;
  const width = Math.min(box.width, bounds.maxWidth);
  const height = width / ratio;
  return { ...clampPosition(box.x, box.y, width, height, bounds), width, height };
}

/**
 * Size and position for a freshly added molecule. Bigger SMILES get a bigger
 * frame, and consecutive additions cascade so they don't stack exactly.
 */
export function placeNewMolecule(
  smilesLength: number,
  cascadeIndex: number,
  bounds: CanvasBounds,
  ratio = MOLECULE_ASPECT_RATIO,
): Box {
  const preferredWidth = clamp(340 + smilesLength * 2.4, 380, 620);
  const width = Math.min(preferredWidth, bounds.maxWidth);
  const height = width / ratio;
  const cascade = (cascadeIndex % 6) * 26;
  return {
    ...clampPosition(
      (bounds.left + bounds.right - width) / 2 + cascade,
      (bounds.top + bounds.bottom - height) / 2 + cascade * 0.4,
      width,
      height,
      bounds,
    ),
    width,
    height,
  };
}

export type ResizeStart = {
  direction: ResizeDirection;
  width: number;
  ratio: number;
  rotation: number;
  /** World position of the corner opposite the dragged handle. */
  anchorX: number;
  anchorY: number;
};

/** World-space offset from a box's center to its corner opposite `direction`. */
export function oppositeCornerOffset(
  direction: ResizeDirection,
  width: number,
  height: number,
  rotation: number,
) {
  const signX = direction.includes("e") ? 1 : -1;
  const signY = direction.includes("s") ? 1 : -1;
  return rotateVector((-signX * width) / 2, (-signY * height) / 2, rotation);
}

/**
 * Resize a (possibly rotated) box by dragging one corner while the opposite
 * corner stays anchored. `deltaX`/`deltaY` are in world units.
 */
export function computeResize(
  start: ResizeStart,
  deltaX: number,
  deltaY: number,
  bounds: CanvasBounds,
): Box {
  const signX = start.direction.includes("e") ? 1 : -1;
  const signY = start.direction.includes("s") ? 1 : -1;
  const localDelta = rotateVector(deltaX, deltaY, -start.rotation);
  const projectedWidthFromX = start.width + localDelta.x * signX;
  const projectedWidthFromY = start.width + localDelta.y * signY * start.ratio;
  const width = clamp(
    Math.abs(localDelta.x) > Math.abs(localDelta.y)
      ? projectedWidthFromX
      : projectedWidthFromY,
    bounds.minWidth,
    bounds.maxWidth,
  );
  const height = width / start.ratio;
  const centerOffset = rotateVector(
    (signX * width) / 2,
    (signY * height) / 2,
    start.rotation,
  );
  const centerX = start.anchorX + centerOffset.x;
  const centerY = start.anchorY + centerOffset.y;
  return {
    ...clampPosition(centerX - width / 2, centerY - height / 2, width, height, bounds),
    width,
    height,
  };
}

export function clampCanvasScale(scale: number) {
  return clamp(scale, MIN_CANVAS_SCALE, MAX_CANVAS_SCALE);
}

/** Zoom to `scale` (clamped) while keeping the stage point (pointX, pointY) fixed. */
export function zoomAround(
  transform: CanvasTransform,
  pointX: number,
  pointY: number,
  scale: number,
): CanvasTransform {
  const worldX = (pointX - transform.x) / transform.scale;
  const worldY = (pointY - transform.y) / transform.scale;
  const nextScale = clampCanvasScale(scale);
  return {
    scale: nextScale,
    x: pointX - worldX * nextScale,
    y: pointY - worldY * nextScale,
  };
}

/** Scale reached by one wheel event with the given pixel delta. */
export function wheelScale(currentScale: number, pixelDelta: number) {
  return currentScale * Math.exp(-clamp(pixelDelta, -100, 100) * 0.0025);
}
