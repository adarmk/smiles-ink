// Post-layout cleanup in plain JS, independent of RDKit. Every step is gated on
// scoreLayout, so a cleanup can only lower the score of the layout it is given.
import {
  adjacency,
  distance,
  findRings,
  medianBondLength,
  pairKey,
  pointInPolygon,
  ringBondKeys,
  scoreLayout,
  segmentsCross,
  type Layout,
  type LayoutScore,
  type Point,
} from "./score.ts";

export type ScoredLayout = { layout: Layout; score: LayoutScore };

const cloneLayout = (layout: Layout): Layout => ({
  atoms: layout.atoms.map((atom) => ({ ...atom })),
  bonds: layout.bonds,
});

const better = (a: ScoredLayout, b: ScoredLayout) =>
  b.score.score < a.score.score ? b : a;

/** Atoms reachable from `start` without crossing the bond start–`other`. */
function subtree(neighbors: number[][], start: number, other: number) {
  const seen = new Set([start, other]);
  const stack = [start];
  const atoms = [start];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of neighbors[u]) {
      if (seen.has(v)) continue;
      seen.add(v);
      atoms.push(v);
      stack.push(v);
    }
  }
  return atoms;
}

/**
 * Mirror acyclic substituents across the bond that attaches them whenever that
 * lowers the score. Cheap and very effective for substituents drawn into a ring.
 */
export function flipSubstituents(layout: Layout, maxPasses = 3): ScoredLayout {
  const n = layout.atoms.length;
  const neighbors = adjacency(n, layout.bonds);
  const ringBonds = ringBondKeys(n, layout.bonds);

  const moves: { pivot: number; first: number; side: number[] }[] = [];
  for (const { a, b } of layout.bonds) {
    if (ringBonds.has(pairKey(a, b))) continue;
    const sideA = subtree(neighbors, a, b);
    const sideB = subtree(neighbors, b, a);
    const [pivot, side] = sideA.length <= sideB.length ? [b, sideA] : [a, sideB];
    // A single atom mirrored across its own bond doesn't move.
    if (side.length >= 2) moves.push({ pivot, first: side[0], side });
  }

  let current: ScoredLayout = { layout, score: scoreLayout(layout) };
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    for (const { pivot, first, side } of moves) {
      const p = current.layout.atoms[pivot];
      const q = current.layout.atoms[first];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const lengthSquared = dx * dx + dy * dy;
      const trial = cloneLayout(current.layout);
      for (const i of side) {
        if (i === first) continue;
        const atom = current.layout.atoms[i];
        const t = ((atom.x - p.x) * dx + (atom.y - p.y) * dy) / lengthSquared;
        trial.atoms[i].x = 2 * (p.x + t * dx) - atom.x;
        trial.atoms[i].y = 2 * (p.y + t * dy) - atom.y;
      }
      const score = scoreLayout(trial);
      if (score.score < current.score.score - 1e-6) {
        current = { layout: trial, score };
        improved = true;
      }
    }
    if (!improved) break;
  }
  return current;
}

type RelaxOptions = { iterations?: number; step?: number; fixed?: Set<number> };

/**
 * Force-directed cleanup: bond springs, angle springs (via 1–3 distances),
 * and repulsion between non-bonded atoms and between atoms and bonds.
 */
export function relax(
  layout: Layout,
  { iterations = 400, step = 0.05, fixed }: RelaxOptions = {},
): ScoredLayout {
  const n = layout.atoms.length;
  const { bonds } = layout;
  if (n < 3) return { layout, score: scoreLayout(layout) };

  const neighbors = adjacency(n, bonds);
  const unit = medianBondLength(layout);

  // Smallest ring containing each i–j–k path sets that angle's target.
  const ringSizeOfAngle = new Map<string, number>();
  for (const ring of findRings(n, bonds, 8)) {
    ring.forEach((i, t) => {
      const j = ring[(t + 1) % ring.length];
      const k = ring[(t + 2) % ring.length];
      const key = i < k ? `${i},${j},${k}` : `${k},${j},${i}`;
      ringSizeOfAngle.set(key, Math.min(ringSizeOfAngle.get(key) ?? 99, ring.length));
    });
  }

  const bonded = new Set(bonds.map(({ a, b }) => pairKey(a, b)));
  const oneThree = new Set<string>();
  // [i, k, target distance, weight]; a negative weight means "only push apart".
  const angles: [number, number, number, number][] = [];
  for (let j = 0; j < n; j++) {
    const around = neighbors[j];
    for (let x = 0; x < around.length; x++) {
      for (let y = x + 1; y < around.length; y++) {
        const i = around[x];
        const k = around[y];
        oneThree.add(pairKey(i, k));
        const ringSize = ringSizeOfAngle.get(i < k ? `${i},${j},${k}` : `${k},${j},${i}`);
        if (ringSize) {
          const interior = (Math.PI * (ringSize - 2)) / ringSize;
          angles.push([i, k, 2 * unit * Math.sin(interior / 2), 0.6]);
        } else if (around.length <= 3) {
          angles.push([i, k, Math.sqrt(3) * unit, 0.4]);
        } else {
          angles.push([i, k, Math.SQRT2 * unit, -1]);
        }
      }
    }
  }

  const X = layout.atoms.map((atom) => [atom.x, atom.y]);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const F = X.map(() => [0, 0]);
    const spring = (i: number, j: number, target: number, weight: number, repelOnly = false) => {
      const dx = X[j][0] - X[i][0];
      const dy = X[j][1] - X[i][1];
      const d = Math.hypot(dx, dy) || 1e-6;
      const difference = d - target;
      if (repelOnly && difference > 0) return;
      const f = (weight * difference) / d;
      F[i][0] += f * dx;
      F[i][1] += f * dy;
      F[j][0] -= f * dx;
      F[j][1] -= f * dy;
    };

    for (const { a, b } of bonds) spring(a, b, unit, 1);
    for (const [i, k, target, weight] of angles) {
      if (weight > 0) spring(i, k, target, weight);
      else spring(i, k, target, 0.6, true);
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = `${i},${j}`;
        if (!bonded.has(key) && !oneThree.has(key)) spring(i, j, 1.25 * unit, 0.8, true);
      }
    }
    for (const { a, b } of bonds) {
      for (let k = 0; k < n; k++) {
        if (k === a || k === b) continue;
        const vx = X[b][0] - X[a][0];
        const vy = X[b][1] - X[a][1];
        const t = ((X[k][0] - X[a][0]) * vx + (X[k][1] - X[a][1]) * vy) / (vx * vx + vy * vy);
        if (t <= 0 || t >= 1) continue;
        const dx = X[k][0] - (X[a][0] + t * vx);
        const dy = X[k][1] - (X[a][1] + t * vy);
        const d = Math.hypot(dx, dy) || 1e-6;
        const limit = 0.6 * unit;
        if (d >= limit) continue;
        const f = (0.8 * (limit - d)) / d;
        F[k][0] += f * dx;
        F[k][1] += f * dy;
        F[a][0] -= f * dx * (1 - t);
        F[a][1] -= f * dy * (1 - t);
        F[b][0] -= f * dx * t;
        F[b][1] -= f * dy * t;
      }
    }

    const s = step * (1 - iteration / iterations) + 0.005;
    for (let i = 0; i < n; i++) {
      if (fixed?.has(i)) continue;
      X[i][0] += s * F[i][0];
      X[i][1] += s * F[i][1];
    }
  }

  const out = cloneLayout(layout);
  X.forEach(([x, y], i) => {
    out.atoms[i].x = x;
    out.atoms[i].y = y;
  });
  return { layout: out, score: scoreLayout(out) };
}

/** Flip → relax → flip, keeping the best intermediate. */
export function repairLayout(layout: Layout): ScoredLayout {
  let best: ScoredLayout = { layout, score: scoreLayout(layout) };
  best = better(best, flipSubstituents(best.layout));
  if (best.score.score > 0) best = better(best, relax(best.layout));
  if (best.score.score > 0) best = better(best, flipSubstituents(best.layout));
  return best;
}

/**
 * Least-squares rigid fit (rotation, optional reflection, translation; no
 * scaling) of template points P onto target points Q.
 */
export function fitTemplate(P: Point[], Q: Point[]): Point[] {
  const centroid = (points: Point[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const cp = centroid(P);
  const cq = centroid(Q);
  let best: { points: Point[]; error: number } | null = null;
  for (const reflection of [1, -1]) {
    const centered = P.map((p) => ({ x: p.x - cp.x, y: reflection * (p.y - cp.y) }));
    let sxx = 0;
    let sxy = 0;
    centered.forEach((p, i) => {
      const qx = Q[i].x - cq.x;
      const qy = Q[i].y - cq.y;
      sxx += p.x * qx + p.y * qy;
      sxy += p.x * qy - p.y * qx;
    });
    const theta = Math.atan2(sxy, sxx);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const points = centered.map((p) => ({
      x: cos * p.x - sin * p.y + cq.x,
      y: sin * p.x + cos * p.y + cq.y,
    }));
    const error = points.reduce((sum, p, i) => sum + distance(p, Q[i]) ** 2, 0);
    if (!best || error < best.error) best = { points, error };
  }
  return best!.points;
}

const MAX_BRIDGE_ATOMS = 4;
const BRIDGE_BULGES = [0.25, 0.5, 0.8, 1.2, 1.7];

/**
 * Short ring bridges between two scaffold atoms that the template doesn't
 * cover (e.g. buprenorphine's 6,14-etheno bridge). Each is returned as an
 * ordered path of atoms from the `start` scaffold atom to the `end` one.
 */
function findBridges(layout: Layout, scaffold: Set<number>) {
  const n = layout.atoms.length;
  const neighbors = adjacency(n, layout.bonds);
  const ringBonds = ringBondKeys(n, layout.bonds);
  const ringNeighbors = (atom: number) =>
    neighbors[atom].filter((other) => ringBonds.has(pairKey(atom, other)));

  const seen = new Set<number>();
  const bridges: { start: number; end: number; path: number[] }[] = [];
  for (let atom = 0; atom < n; atom++) {
    if (scaffold.has(atom) || seen.has(atom) || !ringNeighbors(atom).length) continue;

    // Connected ring atoms outside the scaffold.
    const component = [atom];
    seen.add(atom);
    for (let i = 0; i < component.length; i++) {
      for (const other of ringNeighbors(component[i])) {
        if (!scaffold.has(other) && !seen.has(other)) {
          seen.add(other);
          component.push(other);
        }
      }
    }
    if (component.length > MAX_BRIDGE_ATOMS) continue;

    const inComponent = new Set(component);
    const attachments = component.flatMap((member) =>
      ringNeighbors(member)
        .filter((other) => scaffold.has(other))
        .map((other) => ({ member, other })),
    );
    const internalDegree = (member: number) =>
      ringNeighbors(member).filter((other) => inComponent.has(other)).length;
    // Only a simple chain attached to the scaffold at its two ends.
    if (
      attachments.length !== 2 ||
      component.some((member) => internalDegree(member) > 2) ||
      (component.length > 1 &&
        attachments.some(({ member }) => internalDegree(member) !== 1))
    ) {
      continue;
    }

    const path = [attachments[0].member];
    while (path.length < component.length) {
      const next = ringNeighbors(path[path.length - 1]).find(
        (other) => inComponent.has(other) && !path.includes(other),
      );
      if (next === undefined) break;
      path.push(next);
    }
    if (path.length !== component.length) continue;
    bridges.push({ start: attachments[0].other, end: attachments[1].other, path });
  }
  return bridges;
}

/**
 * Lay each bridge out along a curve between its two scaffold atoms, trying
 * several bulges on both sides and keeping the lowest-scoring one. Mutates
 * `layout` and returns the atoms it placed.
 */
function placeBridges(layout: Layout, scaffold: Set<number>) {
  const n = layout.atoms.length;
  const neighbors = adjacency(n, layout.bonds);
  const unit = medianBondLength(layout);
  const placedAtoms: number[] = [];

  for (const { start, end, path } of findBridges(layout, scaffold)) {
    const u = layout.atoms[start];
    const v = layout.atoms[end];
    const span = distance(u, v) || unit;
    const normal = { x: -(v.y - u.y) / span, y: (v.x - u.x) / span };
    const middle = { x: (u.x + v.x) / 2, y: (u.y + v.y) / 2 };

    // Substituents on bridge atoms move rigidly with their atom.
    const blocked = new Set([...scaffold, ...path]);
    const carried = path.map((member) => {
      const atoms = new Set<number>();
      const stack = neighbors[member].filter((other) => !blocked.has(other));
      while (stack.length) {
        const atom = stack.pop()!;
        if (atoms.has(atom) || blocked.has(atom)) continue;
        atoms.add(atom);
        stack.push(...neighbors[atom]);
      }
      return [...atoms];
    });

    const original = layout.atoms.map((atom) => ({ x: atom.x, y: atom.y }));
    const apply = (bulge: number) => {
      const control = {
        x: middle.x + normal.x * bulge * unit * 2,
        y: middle.y + normal.y * bulge * unit * 2,
      };
      path.forEach((member, index) => {
        const t = (index + 1) / (path.length + 1);
        const x = (1 - t) ** 2 * u.x + 2 * t * (1 - t) * control.x + t ** 2 * v.x;
        const y = (1 - t) ** 2 * u.y + 2 * t * (1 - t) * control.y + t ** 2 * v.y;
        const dx = x - original[member].x;
        const dy = y - original[member].y;
        layout.atoms[member].x = x;
        layout.atoms[member].y = y;
        for (const atom of carried[index]) {
          layout.atoms[atom].x = original[atom].x + dx;
          layout.atoms[atom].y = original[atom].y + dy;
        }
      });
    };

    let bestBulge = 0;
    let bestScore = Infinity;
    for (const bulge of BRIDGE_BULGES.flatMap((b) => [b, -b])) {
      apply(bulge);
      const { score } = scoreLayout(layout);
      if (score < bestScore) {
        bestScore = score;
        bestBulge = bulge;
      }
    }
    apply(bestBulge);
    placedAtoms.push(...path);
  }
  return placedAtoms;
}

/**
 * Snap every match of a scaffold template onto the layout, re-attach acyclic
 * substituents in the emptiest direction, then relax the rest with the
 * scaffolds frozen. `template` must use the same bond length as `layout`;
 * each match lists layout atom indices in template atom order.
 */
export function snapTemplates(
  layout: Layout,
  template: Point[],
  matches: number[][],
): ScoredLayout {
  const out = cloneLayout(layout);
  const n = layout.atoms.length;
  const fixed = new Set<number>();
  const neighbors = adjacency(n, layout.bonds);
  const ringBonds = ringBondKeys(n, layout.bonds);
  const allMatched = new Set(matches.flat());
  const unit = medianBondLength(layout);
  const rings = findRings(n, layout.bonds, 8);

  for (const match of matches) {
    const original = out.atoms.map((atom) => ({ ...atom }));
    const fitted = fitTemplate(template, match.map((i) => out.atoms[i]));
    match.forEach((atom, k) => {
      out.atoms[atom].x = fitted[k].x;
      out.atoms[atom].y = fitted[k].y;
      fixed.add(atom);
    });

    const inMatch = new Set(match);
    const matchRings = rings.filter((ring) => ring.every((i) => inMatch.has(i)));
    const placed = new Set(match);

    for (const anchor of match) {
      const substituents = neighbors[anchor].filter(
        (s) => !inMatch.has(s) && !ringBonds.has(pairKey(anchor, s)),
      );
      if (!substituents.length) continue;

      // Default direction: away from the anchor's scaffold neighbours.
      let fx = 0;
      let fy = 0;
      for (const v of neighbors[anchor].filter((v) => inMatch.has(v))) {
        const dx = out.atoms[v].x - out.atoms[anchor].x;
        const dy = out.atoms[v].y - out.atoms[anchor].y;
        const d = Math.hypot(dx, dy) || 1;
        fx -= dx / d;
        fy -= dy / d;
      }
      const base =
        Math.hypot(fx, fy) < 1e-3
          ? Math.atan2(
              original[substituents[0]].y - original[anchor].y,
              original[substituents[0]].x - original[anchor].x,
            )
          : Math.atan2(fy, fx);

      for (const substituent of substituents) {
        const side = subtree(neighbors, substituent, anchor);
        // Leads to another scaffold copy (e.g. a bivalent ligand): leave it to relax.
        if (side.some((i) => allMatched.has(i))) continue;

        // Scan 24 directions for the most clearance, avoiding crossings and ring interiors.
        let angle = base;
        let bestClearance = -Infinity;
        for (let t = 0; t < 24; t++) {
          const theta = base + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * (Math.PI / 12);
          const tip = {
            x: out.atoms[anchor].x + unit * Math.cos(theta),
            y: out.atoms[anchor].y + unit * Math.sin(theta),
          };
          let clearance = Infinity;
          for (const i of placed) {
            if (i !== anchor) clearance = Math.min(clearance, distance(out.atoms[i], tip));
          }
          const crosses = layout.bonds.some(
            (bond) =>
              placed.has(bond.a) &&
              placed.has(bond.b) &&
              bond.a !== anchor &&
              bond.b !== anchor &&
              segmentsCross(out.atoms[anchor], tip, out.atoms[bond.a], out.atoms[bond.b]),
          );
          if (crosses) clearance -= 10;
          if (matchRings.some((ring) => pointInPolygon(tip, ring.map((i) => out.atoms[i])))) {
            clearance -= 5;
          }
          if (clearance > bestClearance + 0.05 * unit) {
            bestClearance = clearance;
            angle = theta;
          }
        }
        placed.add(substituent);

        // Move the whole substituent rigidly so its first atom lies along `angle`.
        const rotation =
          angle -
          Math.atan2(
            original[substituent].y - original[anchor].y,
            original[substituent].x - original[anchor].x,
          );
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const startX = out.atoms[anchor].x + unit * Math.cos(angle);
        const startY = out.atoms[anchor].y + unit * Math.sin(angle);
        for (const i of side) {
          const px = original[i].x - original[substituent].x;
          const py = original[i].y - original[substituent].y;
          out.atoms[i].x = startX + cos * px - sin * py;
          out.atoms[i].y = startY + sin * px + cos * py;
        }
      }
    }
  }

  for (const atom of placeBridges(out, allMatched)) fixed.add(atom);

  let best: ScoredLayout = { layout: out, score: scoreLayout(out) };
  const flipped = flipSubstituents(out);
  best = better(best, flipped);
  const relaxed = relax(flipped.layout, { fixed, iterations: 300 });
  best = better(best, relaxed);
  const reflipped = flipSubstituents(relaxed.layout);
  best = better(best, reflipped);
  // A brief unfrozen polish.
  best = better(best, relax(reflipped.layout, { iterations: 150, step: 0.02 }));
  return best;
}
