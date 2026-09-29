import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  makeSmilesCandidates,
  splitSmilesInput,
} from "../../app/smiles-cleanup.ts";

const values = (input) => makeSmilesCandidates(input).map((c) => c.value);
const first = (input) => makeSmilesCandidates(input)[0];

describe("splitSmilesInput", () => {
  test("keeps a SMILES wrapped across lines as one entry", () => {
    assert.deepEqual(splitSmilesInput("CC(=O)\nOc1ccccc1"), ["CC(=O)\nOc1ccccc1"]);
  });

  test("splits entries on blank lines, including whitespace-only lines", () => {
    assert.deepEqual(splitSmilesInput("CCO\n\nCCN"), ["CCO", "CCN"]);
    assert.deepEqual(splitSmilesInput("CCO\n  \t\nCCN\n\n\nC"), ["CCO", "CCN", "C"]);
  });

  test("handles Windows line endings", () => {
    assert.deepEqual(splitSmilesInput("CCO\r\n\r\nCCN"), ["CCO", "CCN"]);
  });

  test("drops empty input", () => {
    assert.deepEqual(splitSmilesInput(""), []);
    assert.deepEqual(splitSmilesInput("  \n\n  "), []);
  });
});

describe("makeSmilesCandidates", () => {
  test("returns clean SMILES unchanged with no fixes", () => {
    assert.deepEqual(makeSmilesCandidates("CC(=O)Oc1ccccc1C(=O)O"), [
      { value: "CC(=O)Oc1ccccc1C(=O)O", fixes: [] },
    ]);
  });

  test("never alters stereo, charge, isotope or bracket syntax", () => {
    for (const smiles of [
      "C[C@H](N)C(=O)O",
      "F/C=C/F",
      "[NH4+].[Cl-]",
      "[13CH3]O",
      "c1ccc2c(c1)[nH]c1ccccc12",
      "C1CC[C@@]2(CC1)OCCO2",
    ]) {
      assert.deepEqual(values(smiles), [smiles], smiles);
    }
  });

  test("removes spaces and rejoins wrapped lines", () => {
    assert.equal(first(" C C O ").value, "CCO");
    assert.equal(first("CC(=O)\nOc1ccccc1").value, "CC(=O)Oc1ccccc1");
    assert.ok(first("C C O").fixes.includes("removed spaces"));
  });

  test("strips SMILES labels", () => {
    assert.equal(first("SMILES: CC(=O)O").value, "CC(=O)O");
    assert.equal(first("smiles=CCO").value, "CCO");
    assert.equal(first("Canonical SMILES: CCN").value, "CCN");
    assert.equal(first("SMI CCO").value, "CCO");
    assert.ok(first("SMILES: CCO").fixes.includes("removed SMILES label"));
  });

  test("does not mistake an element symbol for a label", () => {
    // "S" and "Sm" alone are valid SMILES atoms; only full labels are stripped.
    assert.equal(first("SCC").value, "SCC");
    assert.equal(first("[Sm]").value, "[Sm]");
  });

  test("removes invisible characters", () => {
    assert.equal(first("​CCO﻿").value, "CCO");
    assert.ok(first("C⁠CO").fixes.includes("removed hidden characters"));
  });

  test("normalizes Unicode dashes and dots", () => {
    assert.equal(first("CC[Na]·Cl").value, "CC[Na].Cl");
    assert.equal(first("C−C").value, "C-C");
    assert.equal(first("C=C–C").value, "C=C-C");
    assert.ok(first("C‐C").fixes.includes("normalized punctuation"));
  });

  test("normalizes compatibility characters such as full-width letters", () => {
    assert.equal(first("ＣＣＯ").value, "CCO");
    assert.ok(first("ＣＣＯ").fixes.includes("normalized characters"));
  });

  test("strips one pair of wrapping quotes", () => {
    for (const quoted of ['"CCO"', "'CCO'", "`CCO`", "“CCO”", "‘CCO’"]) {
      assert.equal(first(quoted).value, "CCO", quoted);
    }
    assert.equal(first('"CCO').value, '"CCO', "unbalanced quotes are kept");
  });

  test("offers a candidate without trailing punctuation after the literal one", () => {
    assert.deepEqual(values("CCO,"), ["CCO,", "CCO"]);
    assert.deepEqual(values("CCO;;"), ["CCO;;", "CCO"]);
    assert.ok(makeSmilesCandidates("CCO,")[1].fixes.includes("removed trailing punctuation"));
  });

  test("offers the first token when a name follows the SMILES", () => {
    const candidates = values("CCO ethanol");
    assert.deepEqual(candidates, ["CCOethanol", "CCO", "CCO ethanol"]);
    assert.ok(
      makeSmilesCandidates("CCO ethanol")[1].fixes.includes("removed trailing name"),
    );
  });

  test("combines several repairs", () => {
    const { value, fixes } = first("  SMILES: “C C−O”  ");
    assert.equal(value, "CC-O");
    for (const fix of [
      "trimmed whitespace",
      "removed SMILES label",
      "removed wrapping quotes",
      "normalized punctuation",
      "removed spaces",
    ]) {
      assert.ok(fixes.includes(fix), fix);
    }
  });

  test("never returns duplicate or empty candidates", () => {
    for (const input of ["", "   ", "CCO", "C C O", "CCO, ethanol,", '"  "']) {
      const candidates = values(input);
      assert.equal(new Set(candidates).size, candidates.length, input);
      assert.ok(candidates.every(Boolean), input);
    }
  });

  test("does not report the same fix twice", () => {
    for (const { fixes } of makeSmilesCandidates("SMILES: C C O,")) {
      assert.equal(new Set(fixes).size, fixes.length);
    }
  });
});
