// End-to-end layout checks with the real RDKit build. These guard against
// rendering regressions: every hard molecule must stay at or below its
// recorded defect score, and stereochemistry must survive the layout search.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, test } from "node:test";
import {
  createDepicter,
  GOOD_ENOUGH_SCORE,
  layoutMolecule,
  loadTemplates,
} from "../../app/lib/layout/depict.ts";
import { CONTROLS, HARD } from "./molecules.mjs";

const require = createRequire(import.meta.url);
const rdkitDirectory = new URL("../../node_modules/@rdkit/rdkit/dist/", import.meta.url);

let rdkit;
let templates;

before(async () => {
  const initRDKitModule = require(new URL("RDKit_minimal.js", rdkitDirectory).pathname);
  rdkit = await initRDKitModule({
    locateFile: () => new URL("RDKit_minimal.wasm", rdkitDirectory).pathname,
  });
  rdkit.prefer_coordgen(true);
  templates = loadTemplates(rdkit);
});

after(() => {
  for (const template of templates ?? []) template.mol.delete();
});

function canonical(smiles) {
  const mol = rdkit.get_mol(smiles);
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}

function layout(smiles) {
  const result = layoutMolecule(rdkit, smiles, templates);
  assert.ok(result, `no layout for ${smiles}`);
  try {
    return {
      strategy: result.strategy,
      score: result.score,
      canonicalSmiles: result.mol.get_smiles(),
    };
  } finally {
    result.mol.delete();
  }
}

describe("scaffold templates", () => {
  test("all load as query molecules", () => {
    assert.deepEqual(
      templates.map((template) => template.name),
      ["epoxymorphinan", "morphinan"],
    );
  });

  test("match the scaffolds they are meant for", () => {
    const matches = (smiles, name) => {
      const mol = rdkit.get_mol(smiles);
      const template = templates.find((t) => t.name === name);
      const found = JSON.parse(mol.get_substruct_matches(template.mol) || "[]");
      mol.delete();
      return Array.isArray(found) ? found.length : 0;
    };
    const smilesOf = (name) => HARD.find(([n]) => n === name)[1];

    assert.ok(matches(smilesOf("morphine"), "epoxymorphinan") > 0);
    assert.ok(matches(smilesOf("levorphanol"), "morphinan") > 0);
    assert.equal(matches(smilesOf("levorphanol"), "epoxymorphinan"), 0);
    assert.equal(matches(smilesOf("strychnine"), "morphinan"), 0);
  });
});

describe("ordinary molecules keep their CoordGen layout", () => {
  for (const [name, smiles] of CONTROLS) {
    test(name, () => {
      const result = layout(smiles);
      assert.equal(result.strategy, "coordgen");
      assert.ok(result.score.score < GOOD_ENOUGH_SCORE);
      assert.equal(result.canonicalSmiles, canonical(smiles));
    });
  }
});

describe("hard molecules don't regress", () => {
  for (const [name, smiles, baseline] of HARD) {
    test(`${name} (≤ ${baseline})`, () => {
      const result = layout(smiles);
      assert.ok(
        result.score.score <= baseline + 0.05,
        `${name}: ${result.strategy} scored ${result.score.score}, baseline ${baseline}`,
      );
      assert.equal(result.canonicalSmiles, canonical(smiles), "stereochemistry changed");
    });
  }

  test("morphinans have no overlapping atoms or atoms drawn on bonds", () => {
    for (const name of [
      "morphine",
      "naltrexone",
      "naltrindole",
      "levorphanol",
      "dextromethorphan",
      "bivalent naltrexamine-PEG",
    ]) {
      const { score, strategy } = layout(HARD.find(([n]) => n === name)[1]);
      assert.ok(strategy.startsWith("template:"), `${name} used ${strategy}`);
      assert.equal(score.overlaps, 0, name);
      assert.equal(score.atomOnBond, 0, name);
    }
  });

  test("keeps E/Z double-bond stereo through the coordinate round trip", () => {
    // Cyclosporin's (E)-butenyl side chain is the case RDKit JSON drops.
    const smiles = HARD.find(([n]) => n === "cyclosporin")[1];
    assert.match(layout(smiles).canonicalSmiles, /\/C=C\/|\\C=C\\/);
  });
});

describe("depicter", () => {
  test("renders cleanup candidates and reports what it rendered", () => {
    const depicter = createDepicter(rdkit);
    const result = depicter.render("SMILES: C C O", { stereoLabels: false });
    assert.equal(result.smiles, "CCO");
    assert.ok(result.fixes.includes("removed SMILES label"));
    assert.equal(result.canonicalSmiles, "CCO");
    assert.match(result.svg, /<svg/);
    assert.equal(depicter.render("not a molecule", { stereoLabels: false }), null);
  });

  test("shows CIP labels only when asked, without explicit chiral H", () => {
    const depicter = createDepicter(rdkit);
    const morphine = HARD.find(([n]) => n === "morphine")[1];
    const plain = depicter.render(morphine, { stereoLabels: false });
    const labelled = depicter.render(morphine, { stereoLabels: true });

    // RDKit draws annotations as glyph paths with class "note".
    assert.doesNotMatch(plain.svg, /class='note/);
    assert.match(labelled.svg, /class='note/);
    // No explicit H atoms were added at stereocentres: morphine has 21 heavy
    // atoms (indices 0–20), so any higher atom index would be an added H.
    const atomIndices = [...plain.svg.matchAll(/class='atom-(\d+)/g)].map(([, i]) => +i);
    assert.ok(atomIndices.length > 0);
    assert.ok(Math.max(...atomIndices) <= 20, "explicit H drawn");
    // Toggling labels reuses the cached layout rather than laying out again.
    assert.equal(plain.layout.strategy, labelled.layout.strategy);
    assert.equal(plain.layout.score, labelled.layout.score);
  });
});
