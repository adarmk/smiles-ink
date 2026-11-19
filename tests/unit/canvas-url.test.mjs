import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_CANVAS_URL_LENGTH,
  MAX_URL_MOLECULES,
  parseCanvasUrl,
  renderCanvasUrl,
} from "../../app/lib/canvas-url.ts";

const molecule = (overrides = {}) => ({
  smiles: "CCO", x: 40, y: 60, width: 300, height: 200, ...overrides,
});
const query = (entries) => "?" + new URLSearchParams({
  molecules: JSON.stringify(entries),
});
const depiction = (smiles) => ({
  smiles, canonicalSmiles: smiles, svg: "<svg/>",
});

describe("canvas URL", () => {
  test("distinguishes an absent import from an explicitly empty canvas", () => {
    assert.equal(parseCanvasUrl(""), null);
    assert.equal(parseCanvasUrl("?theme=dark"), null);
    assert.deepEqual(parseCanvasUrl("?molecules=%5B%5D"), []);
  });

  test("round-trips multiple placements and chemical URL metacharacters", () => {
    const entries = [
      molecule({ smiles: "[NH4+].[Cl-]", x: -100, y: 0 }),
      molecule({ smiles: "N#CC%12CCCCC%12", width: 1, height: 10_000 }),
      molecule({ smiles: "F/C=C\\F", x: 1_000_000, y: -1_000_000 }),
    ];
    assert.deepEqual(parseCanvasUrl(query(entries)), entries);
  });

  test("trims surrounding whitespace but does not invent or split molecules", () => {
    assert.deepEqual(parseCanvasUrl(query([molecule({ smiles: "  CCO  " })])),
      [molecule()]);
    assert.equal(parseCanvasUrl(query([molecule({ smiles: "C.C" })])).length, 1);
  });

  test("rejects malformed or ambiguous payloads, never silently dropping an entry", () => {
    for (const search of [
      "?molecules=", "?molecules=%", "?molecules=%7B",
      query(null), query({}), query("CCO"),
      query([molecule()]) + "&molecules=%5B%5D",
      query([molecule(), null]), query([[]]), query(["CCO"]),
    ]) {
      assert.throws(() => parseCanvasUrl(search), /Invalid canvas URL/);
    }
  });

  test("requires every field, finite numeric coordinates, and bounded positive sizes", () => {
    for (const field of ["smiles", "x", "y", "width", "height"]) {
      const missing = molecule();
      delete missing[field];
      assert.throws(() => parseCanvasUrl(query([missing])), /molecule 1/);
    }
    for (const overrides of [
      { smiles: "" }, { smiles: "   " }, { smiles: 42 },
      { x: "40" }, { y: null }, { x: Infinity }, { y: NaN },
      { x: 1_000_001 }, { y: -1_000_001 },
      { width: 0 }, { height: -1 }, { width: "300" }, { width: 10_001 },
      { height: Infinity },
    ]) {
      assert.throws(() => parseCanvasUrl(query([molecule(overrides)])), /molecule 1/);
    }
    assert.throws(
      () => parseCanvasUrl('?molecules=' + encodeURIComponent(
        '[{"smiles":"C","x":1e309,"y":0,"width":10,"height":10}]')),
      /molecule 1/,
    );
  });

  test("bounds work before rendering", () => {
    assert.equal(
      parseCanvasUrl(query(Array.from({ length: MAX_URL_MOLECULES }, () => molecule()))).length,
      MAX_URL_MOLECULES,
    );
    assert.throws(
      () => parseCanvasUrl(query(Array.from({ length: MAX_URL_MOLECULES + 1 }, () => molecule()))),
      /at most/,
    );
    assert.throws(
      () => parseCanvasUrl(query([molecule({ smiles: "C".repeat(MAX_CANVAS_URL_LENGTH) })])),
      /too large/,
    );
  });

  test("renders all entries with exact geometry and input-order layering", async () => {
    const entries = [molecule(), molecule({ smiles: "C", x: -40, width: 9000 })];
    let id = 0;
    const calls = [];
    const rendered = await renderCanvasUrl(entries, async (smiles, options) => {
      calls.push([smiles, options]);
      // Deliberately complete the second molecule first.
      if (smiles === "CCO") await new Promise((resolve) => setTimeout(resolve, 5));
      return { ...depiction(smiles), fixes: ["renderer metadata"] };
    }, () => String(++id));
    assert.deepEqual(calls, [["CCO", { stereoLabels: false }], ["C", { stereoLabels: false }]]);
    assert.deepEqual(rendered.map(({ id, ...item }) => item),
      entries.map((entry, index) => ({
        ...entry, ...depiction(entry.smiles), rotation: 0,
        flippedHorizontally: false, flippedVertically: false,
        stereoLabels: false, zIndex: index + 1,
      })));
    assert.equal(new Set(rendered.map((item) => item.id)).size, 2);
    assert.deepEqual(entries, [molecule(), molecule({ smiles: "C", x: -40, width: 9000 })]);
  });

  test("rejects the whole replacement if any chemistry is invalid or rendering fails", async () => {
    const entries = [molecule(), molecule({ smiles: "invalid" })];
    await assert.rejects(
      renderCanvasUrl(entries, async (smiles) => smiles === "invalid" ? null : depiction(smiles), () => "id"),
      /molecule 2 is not valid SMILES/,
    );
    await assert.rejects(
      renderCanvasUrl(entries, async () => { throw new Error("Worker failed"); }, () => "id"),
      /Worker failed/,
    );
  });

  test("an empty snapshot needs no molecule renders", async () => {
    assert.deepEqual(await renderCanvasUrl([], () => {
      assert.fail("must not render an empty canvas");
    }, () => "id"), []);
  });
});
