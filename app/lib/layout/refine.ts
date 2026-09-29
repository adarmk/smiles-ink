// Post-layout cleanup in plain JS, independent of RDKit. Every step is gated on
// scoreLayout, so a cleanup can only lower the score of the layout it is given.
import {
  adjacency,
  distance,
  findRings,
  medianBondLength,
  pairKey,
  ringBondKeys,
  scoreLayout,
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

export type ScaffoldPlacement = {
  /** Layout atom indices, in template order. */
  atoms: number[];
  /** Template coordinates, scaled to the layout's bond length. */
  points: Point[];
};

/** A group of atoms moved as one: a scaffold in its template shape, or any
 * other connected part in its original (usually CoordGen) shape. */
type RigidBody = { atoms: number[]; local: Map<number, Point>; isScaffold: boolean };

const SWING_ANGLES = [0, 15, -15, 30, -30].map((degrees) => (degrees * Math.PI) / 180);

const vectorAt = (angle: number): Point => ({ x: Math.cos(angle), y: Math.sin(angle) });
const angleOf = (v: Point) => Math.atan2(v.y, v.x);

function rotateAbout(v: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Mirror v across the line through the origin along unit vector u. */
function reflect(v: Point, u: Point): Point {
  const dot = v.x * u.x + v.y * u.y;
  return { x: 2 * dot * u.x - v.x, y: 2 * dot * u.y - v.y };
}

/**
 * Directions for a new bond from `center`: bisecting the widest gap between
 * its existing bonds, or ±120° from a single existing bond.
 */
function openDirections(center: Point, bonded: Point[]): Point[] {
  if (!bonded.length) return [{ x: 1, y: 0 }];
  const angles = bonded
    .map((p) => Math.atan2(p.y - center.y, p.x - center.x))
    .sort((a, b) => a - b);
  if (angles.length === 1) {
    return [vectorAt(angles[0] + (2 * Math.PI) / 3), vectorAt(angles[0] - (2 * Math.PI) / 3)];
  }
  let widest = -1;
  let bisector = 0;
  angles.forEach((angle, i) => {
    const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + 2 * Math.PI;
    if (next - angle > widest) {
      widest = next - angle;
      bisector = angle + widest / 2;
    }
  });
  return [vectorAt(bisector)];
}

/** Least-squares rigid transform (rotation + translation, optionally mirrored) taking P onto Q. */
function rigidTransform(P: Point[], Q: Point[], mirrored: boolean) {
  const centroid = (points: Point[]) => ({
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  });
  const cp = centroid(P);
  const cq = centroid(Q);
  const flip = mirrored ? -1 : 1;
  let sxx = 0;
  let sxy = 0;
  P.forEach((p, i) => {
    const px = p.x - cp.x;
    const py = flip * (p.y - cp.y);
    const qx = Q[i].x - cq.x;
    const qy = Q[i].y - cq.y;
    sxx += px * qx + py * qy;
    sxy += px * qy - py * qx;
  });
  const theta = Math.atan2(sxy, sxx);
  return (p: Point): Point => {
    const rotated = rotateAbout({ x: p.x - cp.x, y: flip * (p.y - cp.y) }, theta);
    return { x: rotated.x + cq.x, y: rotated.y + cq.y };
  };
}

/**
 * Least-squares rigid fit (rotation, optional reflection, translation; no
 * scaling) of template points P onto target points Q.
 */
export function fitTemplate(P: Point[], Q: Point[]): Point[] {
  let best: { points: Point[]; error: number } | null = null;
  for (const mirrored of [false, true]) {
    const transform = rigidTransform(P, Q, mirrored);
    const points = P.map(transform);
    const error = points.reduce((sum, p, i) => sum + distance(p, Q[i]) ** 2, 0);
    if (!best || error < best.error) best = { points, error };
  }
  return best!.points;
}

/**
 * Lay a molecule out from rigid pieces: each scaffold match keeps its
 * template shape and every other connected part keeps its shape from
 * `layout` (whose chains and rings are already well drawn). Starting from
 * the first scaffold, each neighbouring piece is attached along an ideal bond
 * direction, or fitted onto the atoms it shares a ring with, trying mirrored
 * and slightly rotated placements and keeping the one with fewest defects.
 * Nothing is bent, so bond lengths and angles inside every piece survive.
 */
export function assembleScaffolds(
  layout: Layout,
  scaffolds: ScaffoldPlacement[],
): ScoredLayout {
  const n = layout.atoms.length;
  const neighbors = adjacency(n, layout.bonds);
  const unit = medianBondLength(layout);

  const bodyOf: number[] = new Array(n).fill(-1);
  const bodies: RigidBody[] = [];
  for (const { atoms, points } of scaffolds) {
    atoms.forEach((atom) => (bodyOf[atom] = bodies.length));
    bodies.push({
      atoms,
      local: new Map(atoms.map((atom, k) => [atom, points[k]])),
      isScaffold: true,
    });
  }
  for (let start = 0; start < n; start++) {
    if (bodyOf[start] !== -1) continue;
    const id = bodies.length;
    const atoms = [start];
    bodyOf[start] = id;
    for (let i = 0; i < atoms.length; i++) {
      for (const next of neighbors[atoms[i]]) {
        if (bodyOf[next] === -1) {
          bodyOf[next] = id;
          atoms.push(next);
        }
      }
    }
    bodies.push({
      atoms,
      local: new Map(atoms.map((atom) => [atom, layout.atoms[atom]])),
      isScaffold: false,
    });
  }

  const position: (Point | null)[] = new Array(n).fill(null);

  const scorePlaced = () => {
    const index = new Map<number, number>();
    const atoms: Layout["atoms"] = [];
    position.forEach((p, atom) => {
      if (!p) return;
      index.set(atom, atoms.length);
      atoms.push({ ...layout.atoms[atom], x: p.x, y: p.y });
    });
    const bonds = layout.bonds
      .filter(({ a, b }) => index.has(a) && index.has(b))
      .map((bond) => ({ ...bond, a: index.get(bond.a)!, b: index.get(bond.b)! }));
    return scoreLayout({ atoms, bonds }).score;
  };

  /** Try each placement of a body and keep the lowest-scoring one. */
  const placeBest = (body: RigidBody, placements: ((p: Point) => Point)[]) => {
    let best: { score: number; placement: (p: Point) => Point } | null = null;
    for (const placement of placements) {
      for (const atom of body.atoms) position[atom] = placement(body.local.get(atom)!);
      const score = scorePlaced();
      if (!best || score < best.score) best = { score, placement };
    }
    for (const atom of body.atoms) position[atom] = best!.placement(body.local.get(atom)!);
  };

  /** Placements hanging a body off one bond p–x, with p already placed. */
  const bondPlacements = (body: RigidBody, p: number, x: number) => {
    const anchor = position[p]!;
    const placedAround = neighbors[p].flatMap((q) => (position[q] ? [position[q]!] : []));
    const origin = body.local.get(x)!;
    // Direction from x back towards p in the body's own frame.
    const towardsP = body.isScaffold
      ? openDirections(
          origin,
          neighbors[x].flatMap((q) => (body.local.has(q) ? [body.local.get(q)!] : [])),
        )
      : [(() => {
          const d = distance(origin, layout.atoms[p]) || 1;
          return {
            x: (layout.atoms[p].x - origin.x) / d,
            y: (layout.atoms[p].y - origin.y) / d,
          };
        })()];

    const placements: ((q: Point) => Point)[] = [];
    for (const out of openDirections(anchor, placedAround)) {
      for (const swing of SWING_ANGLES) {
        const direction = rotateAbout(out, swing);
        const target = { x: anchor.x + unit * direction.x, y: anchor.y + unit * direction.y };
        for (const back of towardsP) {
          const theta = angleOf({ x: -direction.x, y: -direction.y }) - angleOf(back);
          for (const mirrored of [false, true]) {
            placements.push((q) => {
              let relative = { x: q.x - origin.x, y: q.y - origin.y };
              if (mirrored) relative = reflect(relative, back);
              const rotated = rotateAbout(relative, theta);
              return { x: target.x + rotated.x, y: target.y + rotated.y };
            });
          }
        }
      }
    }
    return placements;
  };

  // The first scaffold goes where the original layout roughly put it.
  const root = bodies[0];
  const rootPoints = fitTemplate(
    root.atoms.map((atom) => root.local.get(atom)!),
    root.atoms.map((atom) => layout.atoms[atom]),
  );
  root.atoms.forEach((atom, k) => (position[atom] = rootPoints[k]));

  const placed = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift()!;
    const links = new Map<number, [number, number][]>();
    for (const p of bodies[current].atoms) {
      for (const x of neighbors[p]) {
        const id = bodyOf[x];
        if (placed.has(id)) continue;
        links.set(id, [...(links.get(id) ?? []), [p, x]]);
      }
    }
    for (const [id, attachments] of links) {
      const body = bodies[id];
      const anchors = [...new Set(attachments.map(([p]) => p))];
      if (anchors.length >= 2 && !body.isScaffold) {
        // Fused or bridging: fit the body onto the placed atoms it bonds to,
        // using where those atoms were relative to it originally.
        const from = anchors.map((p) => layout.atoms[p]);
        const to = anchors.map((p) => position[p]!);
        placeBest(body, [false, true].map((mirrored) => rigidTransform(from, to, mirrored)));
      } else {
        const [p, x] = attachments[0];
        placeBest(body, bondPlacements(body, p, x));
      }
      placed.add(id);
      queue.push(id);
    }
  }

  const out = cloneLayout(layout);
  position.forEach((p, atom) => {
    if (!p) return; // Another fragment (e.g. a counter-ion): keep it as drawn.
    out.atoms[atom].x = p.x;
    out.atoms[atom].y = p.y;
  });
  placeBridges(out, new Set(scaffolds.flatMap(({ atoms }) => atoms)));

  // Rigid flips only: they tidy collisions without bending anything.
  return better({ layout: out, score: scoreLayout(out) }, flipSubstituents(out));
}
