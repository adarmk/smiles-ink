import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clampPosition,
  computeCanvasBounds,
  computeResize,
  fitBoxToBounds,
  MAX_CANVAS_SCALE,
  MIN_CANVAS_SCALE,
  normalizeDegrees,
  oppositeCornerOffset,
  placeNewMolecule,
  resizeCursor,
  rotateVector,
  shortestAngleDelta,
  wheelScale,
  zoomAround,
} from "../../app/lib/geometry.ts";

const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ""} ${actual} ≉ ${expected}`);

const desktop = { width: 1200, height: 800, dockTop: 720 };
const identity = { x: 0, y: 0, scale: 1 };

describe("angles", () => {
  test("shortestAngleDelta picks the short way around", () => {
    assert.equal(shortestAngleDelta(10), 10);
    assert.equal(shortestAngleDelta(350), -10);
    assert.equal(shortestAngleDelta(-350), 10);
    assert.equal(shortestAngleDelta(190), -170);
  });

  test("normalizeDegrees maps to [0, 360)", () => {
    assert.equal(normalizeDegrees(0), 0);
    assert.equal(normalizeDegrees(360), 0);
    assert.equal(normalizeDegrees(-15), 345);
    assert.equal(normalizeDegrees(725.4), 5);
  });

  test("rotateVector rotates clockwise in screen coordinates", () => {
    const { x, y } = rotateVector(1, 0, 90);
    close(x, 0);
    close(y, 1);
  });

  test("resizeCursor follows the handle as the box rotates", () => {
    assert.equal(resizeCursor("se", 0), "nwse-resize");
    assert.equal(resizeCursor("ne", 0), "nesw-resize");
    assert.equal(resizeCursor("se", 45), "ns-resize");
    assert.equal(resizeCursor("se", 90), "nesw-resize");
    assert.equal(resizeCursor("nw", -45), "ew-resize");
  });
});

describe("computeCanvasBounds", () => {
  test("keeps molecules clear of the header and the dock", () => {
    const bounds = computeCanvasBounds(desktop);
    assert.equal(bounds.left, 12);
    assert.equal(bounds.right, 1188);
    assert.equal(bounds.top, 48);
    assert.equal(bounds.bottom, 720 - 34);
    assert.equal(bounds.maxWidth, 820);
  });

  test("uses compact spacing on small screens", () => {
    const bounds = computeCanvasBounds({ width: 390, height: 844, dockTop: null });
    assert.equal(bounds.left, 24);
    assert.equal(bounds.top, 70);
    assert.equal(bounds.bottom, 844 - 118 - 42);
    assert.equal(bounds.maxWidth, 390 - 48);
  });

  test("is expressed in world coordinates under pan and zoom", () => {
    const bounds = computeCanvasBounds(desktop, 1.5, { x: 100, y: 50, scale: 2 });
    assert.equal(bounds.left, (12 - 100) / 2);
    assert.equal(bounds.top, (48 - 50) / 2);
    assert.equal(bounds.minWidth, 110);
  });

  test("never lets maxWidth drop below minWidth", () => {
    const bounds = computeCanvasBounds({ width: 120, height: 120, dockTop: 60 });
    assert.ok(bounds.maxWidth >= bounds.minWidth);
  });
});

describe("placement", () => {
  const bounds = computeCanvasBounds(desktop, 1 / 0.67);

  test("clampPosition keeps boxes inside the bounds", () => {
    assert.deepEqual(clampPosition(-500, -500, 100, 100, bounds), {
      x: bounds.left,
      y: bounds.top,
    });
    assert.deepEqual(clampPosition(5000, 5000, 100, 100, bounds), {
      x: bounds.right - 100,
      y: bounds.bottom - 100,
    });
  });

  test("clampPosition pins oversized boxes to the top-left", () => {
    assert.deepEqual(clampPosition(300, 300, 5000, 5000, bounds), {
      x: bounds.left,
      y: bounds.top,
    });
  });

  test("fitBoxToBounds shrinks while preserving aspect ratio", () => {
    const fitted = fitBoxToBounds({ x: 0, y: 0, width: 2000, height: 1000 }, bounds);
    assert.equal(fitted.width, bounds.maxWidth);
    close(fitted.width / fitted.height, 2);
  });

  test("fitBoxToBounds leaves boxes that already fit untouched", () => {
    const box = { x: 100, y: 100, width: 300, height: 200 };
    assert.deepEqual(fitBoxToBounds(box, bounds), box);
  });

  test("placeNewMolecule centers, scales with complexity, and cascades", () => {
    const small = placeNewMolecule(5, 0, bounds);
    const large = placeNewMolecule(200, 0, bounds);
    assert.equal(small.width, 380);
    assert.equal(large.width, 620);
    close(small.x + small.width / 2, (bounds.left + bounds.right) / 2);

    const next = placeNewMolecule(5, 1, bounds);
    assert.equal(next.x - small.x, 26);
    assert.deepEqual(placeNewMolecule(5, 6, bounds), small, "cascade wraps after 6");
  });
});

describe("computeResize", () => {
  const bounds = computeCanvasBounds(desktop, 1.5);
  const box = { x: 200, y: 200, width: 300, height: 200 };

  const startFor = (direction, rotation = 0) => {
    const corner = oppositeCornerOffset(direction, box.width, box.height, rotation);
    return {
      direction,
      width: box.width,
      ratio: box.width / box.height,
      rotation,
      anchorX: box.x + box.width / 2 + corner.x,
      anchorY: box.y + box.height / 2 + corner.y,
    };
  };

  test("dragging the south-east corner grows the box from the north-west", () => {
    const result = computeResize(startFor("se"), 60, 0, bounds);
    assert.equal(result.width, 360);
    assert.equal(result.height, 240);
    assert.equal(result.x, 200);
    assert.equal(result.y, 200);
  });

  test("dragging the north-west corner keeps the south-east corner fixed", () => {
    const result = computeResize(startFor("nw"), -60, 0, bounds);
    assert.equal(result.width, 360);
    close(result.x + result.width, 500);
    close(result.y + result.height, 400);
  });

  test("respects the minimum and maximum widths", () => {
    assert.equal(computeResize(startFor("se"), -1000, 0, bounds).width, bounds.minWidth);
    assert.equal(computeResize(startFor("se"), 5000, 0, bounds).width, bounds.maxWidth);
  });

  test("works in the box's own frame when rotated", () => {
    // Rotated 90°, dragging the screen-down direction lengthens the box.
    const result = computeResize(startFor("se", 90), 0, 60, bounds);
    assert.equal(result.width, 360);
  });
});

describe("zoom", () => {
  test("zoomAround keeps the point under the cursor fixed", () => {
    const next = zoomAround(identity, 400, 300, 2);
    assert.equal(next.scale, 2);
    close((400 - next.x) / next.scale, 400);
    close((300 - next.y) / next.scale, 300);
  });

  test("zoomAround clamps the scale", () => {
    assert.equal(zoomAround(identity, 0, 0, 100).scale, MAX_CANVAS_SCALE);
    assert.equal(zoomAround(identity, 0, 0, 0.01).scale, MIN_CANVAS_SCALE);
  });

  test("wheelScale zooms in on negative deltas and caps huge deltas", () => {
    assert.ok(wheelScale(1, -10) > 1);
    assert.ok(wheelScale(1, 10) < 1);
    assert.equal(wheelScale(1, 10_000), wheelScale(1, 100));
  });
});
