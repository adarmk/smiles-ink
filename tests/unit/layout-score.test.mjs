import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assembleScaffolds,
  fitTemplate,
  flipSubstituents,
  repairLayout,
} from "../../app/lib/layout/refine.ts";
import {
  findRings,
  parseMolblock,
  scoreLayout,
  segmentsCross,
} from "../../app/lib/layout/score.ts";

const atom = (x, y, element = "C") => ({ x, y, element });
const bond = (a, b, order = 1) => ({ a, b, order });

/** Regular hexagon with unit bonds, centred on the origin. */
function hexagon() {
  return Array.from({ length: 6 }, (_, i) =>
    atom(Math.cos((Math.PI / 3) * i), Math.sin((Math.PI / 3) * i)),
  );
}
const ringBonds = [bond(0, 1), bond(1, 2), bond(2, 3), bond(3, 4), bond(4, 5), bond(5, 0)];

describe("scoreLayout", () => {
  test("a regular ring scores zero", () => {
    assert.equal(scoreLayout({ atoms: hexagon(), bonds: ringBonds }).score, 0);
  });

  test("counts crossing bonds", () => {
    const layout = {
      atoms: [atom(0, 0), atom(1, 1), atom(0, 1), atom(1, 0)],
      bonds: [bond(0, 1), bond(2, 3)],
    };
    assert.equal(scoreLayout(layout).crossings, 1);
  });

  test("bonds that share an atom never count as crossing", () => {
    assert.equal(segmentsCross(atom(0, 0), atom(1, 0), atom(1, 0), atom(2, 1)), false);
  });

  test("counts overlapping atoms", () => {
    const layout = {
      atoms: [atom(0, 0), atom(1, 0), atom(1.1, 0.05), atom(2.1, 0.05)],
      bonds: [bond(0, 1), bond(2, 3)],
    };
    assert.equal(scoreLayout(layout).overlaps, 1);
  });

  test("counts atoms sitting on a bond", () => {
    const layout = {
      atoms: [atom(0, 0), atom(2, 0), atom(1, 0.05), atom(1, 1.05)],
      bonds: [bond(0, 1), bond(2, 3)],
    };
    assert.ok(scoreLayout(layout).atomOnBond >= 1);
  });

  test("flags substituents drawn inside a ring", () => {
    const layout = {
      atoms: [...hexagon(), atom(0.2, 0)],
      bonds: [...ringBonds, bond(0, 6)],
    };
    assert.equal(scoreLayout(layout).substituentsInRings, 1);
  });

  test("zigzag chains at 120° have no angle strain; bent ones do", () => {
    const chain = (degrees) => {
      const turn = (degrees * Math.PI) / 180;
      const atoms = [atom(0, 0), atom(1, 0)];
      // Alternate the turn direction so the chain zigzags.
      let heading = 0;
      for (let i = 2; i < 6; i++) {
        heading += (i % 2 ? 1 : -1) * (Math.PI - turn);
        const last = atoms[i - 1];
        atoms.push(atom(last.x + Math.cos(heading), last.y + Math.sin(heading)));
      }
      return { atoms, bonds: [0, 1, 2, 3, 4].map((i) => bond(i, i + 1)) };
    };
    assert.equal(scoreLayout(chain(120)).angleStrain, 0);
    assert.ok(scoreLayout(chain(90)).angleStrain > 1);
  });

  test("ring atoms are measured against the ring's own angle", () => {
    // A regular hexagon with an outward substituent is ideal everywhere.
    const layout = {
      atoms: [...hexagon(), atom(2, 0)],
      bonds: [...ringBonds, bond(0, 6)],
    };
    assert.equal(scoreLayout(layout).angleStrain, 0);
  });

  test("allows straight triple bonds but flags straight single bonds", () => {
    const straight = (order) => ({
      atoms: [atom(0, 0), atom(1, 0), atom(2, 0)],
      bonds: [bond(0, 1, order), bond(1, 2)],
    });
    assert.equal(scoreLayout(straight(3)).linear, 0);
    assert.equal(scoreLayout(straight(1)).linear, 1);
  });
});

describe("findRings", () => {
  test("finds the two rings of a fused bicycle", () => {
    // Naphthalene-like: two hexagons sharing the 0–1 bond.
    const bonds = [
      bond(0, 1), bond(1, 2), bond(2, 3), bond(3, 4), bond(4, 5), bond(5, 0),
      bond(1, 6), bond(6, 7), bond(7, 8), bond(8, 9), bond(9, 0),
    ];
    const sizes = findRings(10, bonds).map((ring) => ring.length).sort();
    assert.deepEqual(sizes, [6, 6]);
  });
});

describe("parseMolblock", () => {
  test("reads V2000 coordinates, elements and bonds", () => {
    const molblock = [
      "",
      "  test",
      "",
      "  2  1  0  0  0  0  0  0  0  0999 V2000",
      "    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0",
      "    1.5000   -0.5000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0",
      "  1  2  2  0",
      "M  END",
    ].join("\n");
    assert.deepEqual(parseMolblock(molblock), {
      atoms: [atom(0, 0, "C"), atom(1.5, -0.5, "O")],
      bonds: [bond(0, 1, 2)],
    });
  });
});

describe("refinement", () => {
  test("flipSubstituents mirrors a substituent away from a collision", () => {
    // Atom 7 (on the chain from atom 0) lands on atom 8 (bonded to atom 1);
    // mirroring the chain across its attachment bond separates them.
    const layout = {
      atoms: [...hexagon(), atom(2, 0), atom(2.5, 0.866), atom(2.55, 0.9)],
      bonds: [...ringBonds, bond(0, 6), bond(6, 7), bond(1, 8)],
    };
    assert.equal(scoreLayout(layout).overlaps, 1);
    const flipped = flipSubstituents(layout);
    assert.equal(flipped.score.overlaps, 0);
    assert.ok(flipped.layout.atoms[7].y < 0, "chain mirrored below the ring");
  });

  test("repairLayout never makes a layout worse", () => {
    const layout = { atoms: hexagon(), bonds: ringBonds };
    assert.equal(repairLayout(layout).score.score, 0);
  });

  test("fitTemplate recovers a rotated and mirrored copy", () => {
    const template = [atom(0, 0), atom(1, 0), atom(1, 2)];
    // Mirror across x, rotate 90°, then translate.
    const target = template.map(({ x, y }) => ({ x: y + 5, y: x - 3 }));
    const fitted = fitTemplate(template, target);
    fitted.forEach((point, i) => {
      assert.ok(Math.abs(point.x - target[i].x) < 1e-9);
      assert.ok(Math.abs(point.y - target[i].y) < 1e-9);
    });
  });

  test("assembleScaffolds snaps the scaffold without bending the rest", () => {
    // A squashed ring (the "scaffold") with a zigzag chain on atom 0.
    const squashed = hexagon().map(({ x, y }) => atom(x, y * 0.5));
    const chain = [atom(2, 0), atom(2.5, 0.866), atom(3.5, 0.866)];
    const layout = {
      atoms: [...squashed, ...chain],
      bonds: [...ringBonds, bond(0, 6), bond(6, 7), bond(7, 8)],
    };
    const template = hexagon().map(({ x, y }) => ({ x, y }));
    const { layout: result } = assembleScaffolds(layout, [
      { atoms: [0, 1, 2, 3, 4, 5], points: template },
    ]);
    const d = (i, j) => Math.hypot(
      result.atoms[i].x - result.atoms[j].x,
      result.atoms[i].y - result.atoms[j].y,
    );
    const close = (actual, expected, message) =>
      assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

    // Scaffold takes the template's shape.
    close(d(0, 3), 2, "ring diameter");
    // The chain keeps its own shape exactly.
    close(d(6, 8), Math.hypot(1.5, 0.866), "chain 1–3 distance");
    // And hangs off the ring at an ideal bond length and angle.
    // (The squashed ring shortens the layout's median bond very slightly.)
    assert.ok(Math.abs(d(0, 6) - 1) < 1e-3, "attachment bond");
    assert.equal(scoreLayout(result).angleStrain, 0);
  });
});
