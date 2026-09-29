import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseSavedCanvas, serializeCanvas } from "../../app/lib/persistence.ts";

const molecule = (overrides = {}) => ({
  id: "a",
  smiles: "CCO",
  canonicalSmiles: "CCO",
  svg: "<svg>…</svg>",
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  rotation: 45,
  flippedHorizontally: true,
  flippedVertically: false,
  stereoLabels: true,
  zIndex: 1,
  ...overrides,
});

const transform = { x: -40, y: 12, scale: 1.5 };

describe("canvas persistence", () => {
  test("round-trips layout without storing rendered output", () => {
    const raw = serializeCanvas([molecule()], transform);
    assert.doesNotMatch(raw, /<svg>/);
    assert.doesNotMatch(raw, /canonicalSmiles/);

    const { svg, canonicalSmiles, ...layout } = molecule();
    assert.deepEqual(parseSavedCanvas(raw), {
      molecules: [layout],
      transform,
    });
  });

  test("returns null for missing, corrupt, or foreign data", () => {
    assert.equal(parseSavedCanvas(null), null);
    assert.equal(parseSavedCanvas(""), null);
    assert.equal(parseSavedCanvas("{not json"), null);
    assert.equal(parseSavedCanvas("[]"), null);
    assert.equal(parseSavedCanvas('"hello"'), null);
    assert.equal(parseSavedCanvas(JSON.stringify({ version: 99, molecules: [] })), null);
  });

  test("drops malformed molecules and keeps the rest", () => {
    const raw = JSON.stringify({
      version: 1,
      transform,
      molecules: [
        { id: "ok", smiles: "C", x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 },
        { id: "no-smiles", x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 },
        { id: "nan", smiles: "C", x: null, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 },
        { id: "zero", smiles: "C", x: 0, y: 0, width: 0, height: 10, rotation: 0, zIndex: 1 },
        { id: "ok", smiles: "CC", x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 2 },
        "garbage",
        null,
      ],
    });

    const saved = parseSavedCanvas(raw);
    assert.deepEqual(
      saved.molecules.map((item) => item.id),
      ["ok"],
      "invalid entries and duplicate ids are dropped",
    );
    assert.equal(saved.molecules[0].flippedHorizontally, false);
    assert.equal(saved.molecules[0].stereoLabels, false);
  });

  test("falls back to the default viewport when the transform is invalid", () => {
    const raw = JSON.stringify({
      version: 1,
      transform: { x: 0, y: 0, scale: -2 },
      molecules: [],
    });
    assert.deepEqual(parseSavedCanvas(raw).transform, { x: 0, y: 0, scale: 1 });
  });
});
