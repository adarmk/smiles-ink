// Layout-quality scoring for 2D depictions. Pure functions over plain
// coordinates, so they run in the worker, in tests, and without RDKit.
// Lower scores are better; 0 means no detected defects.

export type Point = { x: number; y: number };
export type LayoutAtom = Point & { element: string };
export type LayoutBond = { a: number; b: number; order: number };
export type Layout = { atoms: LayoutAtom[]; bonds: LayoutBond[] };

export type LayoutScore = {
  score: number;
  crossings: number;
  overlaps: number;
  nearOverlaps: number;
  atomOnBond: number;
  bondLengthSpread: number;
  badBondLengths: number;
  ringPenalty: number;
  linear: number;
  substituentsInRings: number;
  /** Summed bond-angle deviation beyond a tolerance, in units of 30°. */
  angleStrain: number;
};

export const SCORE_WEIGHTS = {
  crossing: 10,
  overlap: 8,
  nearOverlap: 3,
  atomOnBond: 5,
  bondLength: 1,
  ring: 2,
  linear: 6,
  substituentInRing: 6,
  angleStrain: 3,
};

/** Parse atoms and bonds from a V2000 or V3000 molblock. */
export function parseMolblock(molblock: string): Layout {
  const lines = molblock.split("\n");
  if (lines[3]?.includes("V3000")) return parseV3000(lines);

  const atomCount = parseInt(lines[3].slice(0, 3), 10);
  const bondCount = parseInt(lines[3].slice(3, 6), 10);
  const atoms: LayoutAtom[] = [];
  const bonds: LayoutBond[] = [];
  for (let i = 0; i < atomCount; i++) {
    const line = lines[4 + i];
    atoms.push({
      x: parseFloat(line.slice(0, 10)),
      y: parseFloat(line.slice(10, 20)),
      element: line.slice(31, 34).trim(),
    });
  }
  for (let i = 0; i < bondCount; i++) {
    const line = lines[4 + atomCount + i];
    bonds.push({
      a: parseInt(line.slice(0, 3), 10) - 1,
      b: parseInt(line.slice(3, 6), 10) - 1,
      order: parseInt(line.slice(6, 9), 10),
    });
  }
  return { atoms, bonds };
}

function parseV3000(lines: string[]): Layout {
  const atoms: LayoutAtom[] = [];
  const bonds: LayoutBond[] = [];
  let section: "atoms" | "bonds" | null = null;
  for (const line of lines) {
    if (line.includes("BEGIN ATOM")) section = "atoms";
    else if (line.includes("BEGIN BOND")) section = "bonds";
    else if (line.includes("END ATOM") || line.includes("END BOND")) section = null;
    else if (section) {
      const fields = line.trim().split(/\s+/);
      if (section === "atoms") {
        atoms.push({ element: fields[3], x: +fields[4], y: +fields[5] });
      } else {
        bonds.push({ order: +fields[3], a: +fields[4] - 1, b: +fields[5] - 1 });
      }
    }
  }
  return { atoms, bonds };
}

export const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

export function distance(p: Point, q: Point) {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function medianBondLength(layout: Layout) {
  return (
    median(layout.bonds.map(({ a, b }) => distance(layout.atoms[a], layout.atoms[b]))) || 1
  );
}

export function adjacency(atomCount: number, bonds: LayoutBond[]) {
  const neighbors: number[][] = Array.from({ length: atomCount }, () => []);
  for (const { a, b } of bonds) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  return neighbors;
}

/** Proper intersection of segments p1–p2 and p3–p4 (touching doesn't count). */
export function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point) {
  const side = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const eps = 1e-9;
  const d1 = side(p3, p4, p1);
  const d2 = side(p3, p4, p2);
  const d3 = side(p1, p2, p3);
  const d4 = side(p1, p2, p4);
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

export function pointInPolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from p to segment a–b, and whether p projects onto its interior. */
function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSquared = vx * vx + vy * vy;
  let t = lengthSquared ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared : 0;
  const interior = t > 0.05 && t < 0.95;
  t = Math.max(0, Math.min(1, t));
  return {
    distance: Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y),
    interior,
  };
}

/**
 * Small rings: the shortest cycle through each bond, up to `maxSize` atoms,
 * deduplicated by atom set. Each ring is an ordered list of atom indices.
 */
export function findRings(atomCount: number, bonds: LayoutBond[], maxSize = 8) {
  const neighbors = adjacency(atomCount, bonds);
  const rings = new Map<string, number[]>();
  for (const { a, b } of bonds) {
    const previous = new Map<number, number>([[a, -1]]);
    const queue = [a];
    let found = false;
    while (queue.length && !found) {
      const u = queue.shift()!;
      for (const v of neighbors[u]) {
        if ((u === a && v === b) || previous.has(v)) continue;
        previous.set(v, u);
        if (v === b) {
          found = true;
          break;
        }
        queue.push(v);
      }
    }
    if (!found) continue;
    const path: number[] = [];
    for (let v = b; v !== -1; v = previous.get(v)!) path.push(v);
    if (path.length > maxSize) continue;
    const key = [...path].sort((x, y) => x - y).join(",");
    if (!rings.has(key)) rings.set(key, path);
  }
  return [...rings.values()];
}

export function ringBondKeys(atomCount: number, bonds: LayoutBond[]) {
  const keys = new Set<string>();
  for (const ring of findRings(atomCount, bonds, 64)) {
    ring.forEach((atom, i) => keys.add(pairKey(atom, ring[(i + 1) % ring.length])));
  }
  return keys;
}

function polygonArea(points: Point[]) {
  let sum = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return sum / 2;
}

const EMPTY_SCORE: LayoutScore = {
  score: 0,
  crossings: 0,
  overlaps: 0,
  nearOverlaps: 0,
  atomOnBond: 0,
  bondLengthSpread: 0,
  badBondLengths: 0,
  ringPenalty: 0,
  linear: 0,
  substituentsInRings: 0,
  angleStrain: 0,
};

export function scoreLayout(layout: Layout, weights = SCORE_WEIGHTS): LayoutScore {
  const { atoms, bonds } = layout;
  const n = atoms.length;
  if (!bonds.length) return EMPTY_SCORE;

  const lengths = bonds.map(({ a, b }) => distance(atoms[a], atoms[b]));
  const unit = median(lengths) || 1;
  const bonded = new Set(bonds.map(({ a, b }) => pairKey(a, b)));

  // Bonds that cross without sharing an atom.
  let crossings = 0;
  for (let i = 0; i < bonds.length; i++) {
    for (let j = i + 1; j < bonds.length; j++) {
      const p = bonds[i];
      const q = bonds[j];
      if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) continue;
      if (segmentsCross(atoms[p.a], atoms[p.b], atoms[q.a], atoms[q.b])) crossings++;
    }
  }

  // Non-bonded atoms drawn on top of or crowding each other.
  let overlaps = 0;
  let nearOverlaps = 0;
  let nearPenalty = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bonded.has(`${i},${j}`)) continue;
      const d = distance(atoms[i], atoms[j]) / unit;
      if (d < 0.4) overlaps++;
      else if (d < 0.75) {
        nearOverlaps++;
        nearPenalty += (0.75 - d) / 0.35;
      }
    }
  }

  // Atoms sitting on a bond they don't belong to.
  let atomOnBond = 0;
  for (const { a, b } of bonds) {
    for (let k = 0; k < n; k++) {
      if (k === a || k === b) continue;
      const { distance: d, interior } = pointSegmentDistance(atoms[k], atoms[a], atoms[b]);
      if (interior && d / unit < 0.3) atomOnBond++;
    }
  }

  // Bond length uniformity.
  const relative = lengths.map((length) => length / unit);
  const mean = relative.reduce((sum, x) => sum + x, 0) / relative.length;
  const bondLengthSpread =
    Math.sqrt(relative.reduce((sum, x) => sum + (x - mean) ** 2, 0) / relative.length) / mean;
  const badBondLengths = relative.filter((x) => x < 0.7 || x > 1.35).length;

  // Two-neighbour atoms drawn straight: they read as one long bond and RDKit
  // prints an explicit carbon label. Triple bonds and allenes are meant to be linear.
  let linear = 0;
  const bondOrders: [number, number][][] = Array.from({ length: n }, () => []);
  for (const { a, b, order } of bonds) {
    bondOrders[a].push([b, order]);
    bondOrders[b].push([a, order]);
  }
  for (let i = 0; i < n; i++) {
    if (bondOrders[i].length !== 2) continue;
    const [[j, firstOrder], [k, secondOrder]] = bondOrders[i];
    if (firstOrder === 3 || secondOrder === 3 || (firstOrder === 2 && secondOrder === 2)) continue;
    const ux = atoms[j].x - atoms[i].x;
    const uy = atoms[j].y - atoms[i].y;
    const vx = atoms[k].x - atoms[i].x;
    const vy = atoms[k].y - atoms[i].y;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    if (cos < -0.94) linear++;
  }

  // Rings: substituents drawn inside them, and squashed or folded rings.
  const rings = findRings(n, bonds, 8);
  const ringAtoms = new Set(rings.flat());
  let substituentsInRings = 0;
  let ringPenalty = 0;
  for (const ring of rings) {
    const polygon = ring.map((i) => atoms[i]);
    for (let k = 0; k < n; k++) {
      if (!ringAtoms.has(k) && pointInPolygon(atoms[k], polygon)) substituentsInRings++;
    }
    const size = ring.length;
    const regularArea = (size * unit * unit) / (4 * Math.tan(Math.PI / size));
    const ratio = Math.abs(polygonArea(polygon)) / regularArea;
    if (ratio < 0.6) ringPenalty += (0.6 - ratio) / 0.6;
  }

  const angleStrain = measureAngleStrain(layout, rings);

  const score =
    weights.crossing * crossings +
    weights.overlap * overlaps +
    weights.nearOverlap * nearPenalty +
    weights.atomOnBond * atomOnBond +
    weights.bondLength * (badBondLengths + 10 * bondLengthSpread) +
    weights.ring * ringPenalty +
    weights.linear * linear +
    weights.substituentInRing * substituentsInRings +
    weights.angleStrain * angleStrain;

  return {
    score: Math.round(score * 100) / 100,
    crossings,
    overlaps,
    nearOverlaps,
    atomOnBond,
    bondLengthSpread: Math.round(bondLengthSpread * 1000) / 1000,
    badBondLengths,
    ringPenalty: Math.round(ringPenalty * 100) / 100,
    linear,
    substituentsInRings,
    angleStrain: Math.round(angleStrain * 100) / 100,
  };
}

const ANGLE_TOLERANCE = 12;

function angleAt(center: Point, a: Point, b: Point) {
  const ux = a.x - center.x;
  const uy = a.y - center.y;
  const vx = b.x - center.x;
  const vy = b.y - center.y;
  const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * How far bond angles stray from what a chemist would draw: 120° in chains,
 * the regular-polygon angle inside rings, and the matching exocyclic angle.
 * Bridged rings (sharing three or more atoms with another ring) can't be
 * drawn with ideal angles at all, so their atoms are skipped, as are
 * four-connected atoms.
 */
function measureAngleStrain(layout: Layout, rings: number[][]) {
  const { atoms, bonds } = layout;
  const neighbors: { atom: number; order: number }[][] = atoms.map(() => []);
  for (const { a, b, order } of bonds) {
    neighbors[a].push({ atom: b, order });
    neighbors[b].push({ atom: a, order });
  }
  // For each atom, the ring sizes that each neighbour pair borders.
  const ringAngles = atoms.map(() => new Map<string, number[]>());
  const ringCount = atoms.map(() => 0);
  for (const ring of rings) {
    ring.forEach((atom, t) => {
      const previous = ring[(t + ring.length - 1) % ring.length];
      const next = ring[(t + 1) % ring.length];
      const key = pairKey(previous, next);
      const sizes = ringAngles[atom].get(key) ?? [];
      sizes.push(ring.length);
      ringAngles[atom].set(key, sizes);
      ringCount[atom]++;
    });
  }

  const bridged = new Set<number>();
  for (let i = 0; i < rings.length; i++) {
    const members = new Set(rings[i]);
    for (let k = i + 1; k < rings.length; k++) {
      if (rings[k].filter((atom) => members.has(atom)).length >= 3) {
        rings[i].forEach((atom) => bridged.add(atom));
        rings[k].forEach((atom) => bridged.add(atom));
      }
    }
  }

  let strain = 0;
  const addDeviation = (actual: number, ideal: number) => {
    const deviation = Math.abs(actual - ideal);
    if (deviation > ANGLE_TOLERANCE) strain += (deviation - ANGLE_TOLERANCE) / 30;
  };

  for (let j = 0; j < atoms.length; j++) {
    const around = neighbors[j];
    if (around.length < 2 || around.length > 3 || ringCount[j] > 2 || bridged.has(j)) {
      continue;
    }

    if (around.length === 2) {
      const [first, second] = around;
      const angle = angleAt(atoms[j], atoms[first.atom], atoms[second.atom]);
      const sizes = ringAngles[j].get(pairKey(first.atom, second.atom));
      if (sizes) {
        if (new Set(sizes).size === 1) addDeviation(angle, 180 - 360 / sizes[0]);
      } else if (
        first.order === 3 ||
        second.order === 3 ||
        (first.order === 2 && second.order === 2)
      ) {
        addDeviation(angle, 180);
      } else {
        addDeviation(angle, 120);
      }
      continue;
    }

    // Three neighbours: ring angles are fixed by their rings; the others
    // share what's left of 360°.
    const pairs = [
      [around[0].atom, around[1].atom],
      [around[0].atom, around[2].atom],
      [around[1].atom, around[2].atom],
    ];
    const ideals = pairs.map(([a, b]) => {
      const sizes = ringAngles[j].get(pairKey(a, b));
      return sizes ? (new Set(sizes).size === 1 ? 180 - 360 / sizes[0] : NaN) : null;
    });
    if (ideals.some((ideal) => Number.isNaN(ideal))) continue;
    const fixedTotal = ideals.reduce<number>((sum, ideal) => sum + (ideal ?? 0), 0);
    const freeCount = ideals.filter((ideal) => ideal === null).length;
    const freeIdeal = freeCount ? (360 - fixedTotal) / freeCount : 0;
    pairs.forEach(([a, b], index) => {
      addDeviation(angleAt(atoms[j], atoms[a], atoms[b]), ideals[index] ?? freeIdeal);
    });
  }
  return strain;
}
