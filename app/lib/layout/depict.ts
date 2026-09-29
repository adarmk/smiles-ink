// SMILES → SVG with layout search. Runs wherever an RDKit module is available
// (the rendering worker, and Node in tests); it never touches the DOM.
//
// Automatic 2D layout is unreliable for bridged polycycles, so for any
// molecule whose first layout has visible defects we generate several
// candidates, score each for defects, clean up the most promising ones, and
// keep the best:
//   1. CoordGen (the default; almost always clean for ordinary molecules).
//   2. RDKit's native depictor.
//   3. Curated scaffold templates, applied with generate_aligned_coords and
//      then snapped onto every copy of the scaffold.
//   4. The native depictor on a few different atom orderings.
//   5. Flip/relax cleanup of the best raw candidates.
import type { JSMol, RDKitModule } from "@rdkit/rdkit";
import { makeSmilesCandidates } from "../../smiles-cleanup.ts";
import { assembleScaffolds, repairLayout } from "./refine.ts";
import {
  medianBondLength,
  parseMolblock,
  scoreLayout,
  type Layout,
  type LayoutScore,
} from "./score.ts";
import {
  SCAFFOLD_TEMPLATES,
  templateMolblock,
  type ScaffoldTemplate,
} from "./templates.ts";

/** Below this score a layout is clean enough that searching further is pointless. */
export const GOOD_ENOUGH_SCORE = 3;
/** Larger molecules keep their CoordGen layout; the search would take too long. */
const MAX_SEARCH_ATOMS = 150;
/** A template layout wins unless another candidate beats it by more than this. */
const TEMPLATE_PREFERENCE = 8;
const ALTERNATE_ORDERINGS = 4;
const REPAIRED_CANDIDATES = 2;
const LAYOUT_CACHE_SIZE = 48;

const DRAW_OPTIONS = {
  width: 720,
  height: 480,
  clearBackground: false,
  centreMoleculesBeforeDrawing: true,
  padding: 0.025,
  bondLineWidth: 1.8,
  multipleBondOffset: 0.16,
  minFontSize: 14,
  maxFontSize: 34,
  annotationFontScale: 0.72,
  includeRadicals: true,
  explicitMethyl: false,
  // Explicit H on stereocentres collides with bonds at bridgeheads; wedges on
  // heavy-atom bonds already convey the stereochemistry.
  addChiralHs: false,
};

export type RenderOptions = {
  /** Show CIP (R)/(S) and (E)/(Z) labels. */
  stereoLabels: boolean;
};

export type LayoutResult = {
  mol: JSMol;
  strategy: string;
  score: LayoutScore;
};

export type RenderedMolecule = {
  /** The cleanup candidate that parsed, i.e. what was actually rendered. */
  smiles: string;
  fixes: string[];
  canonicalSmiles: string;
  /** Raw RDKit SVG. */
  svg: string;
  layout: { strategy: string; score: number };
};

type LoadedTemplate = { name: string; mol: JSMol; layout: Layout };

type Candidate = LayoutResult & {
  layout: Layout;
  fromTemplate: boolean;
  refined: boolean;
};

function parseMol(rdkit: RDKitModule, input: string): JSMol | null {
  try {
    const mol = rdkit.get_mol(input);
    if (mol?.is_valid()) return mol;
    mol?.delete();
  } catch {
    // Invalid input; the caller moves on.
  }
  return null;
}

/**
 * Give `mol` new 2D coordinates without disturbing stereochemistry. Returns a
 * new mol, or null if the round trip would change the molecule.
 */
export function withCoordinates(
  rdkit: RDKitModule,
  mol: JSMol,
  layout: Layout,
): JSMol | null {
  // RDKit JSON keeps tetrahedral stereo (wedges are re-derived from the new
  // coordinates) but this build drops cis/trans stereo on JSON input. Going
  // JSON → molblock and clearing the "either" flag on bonds that had E/Z fixes
  // that, because the new coordinates already have the right geometry.
  const json = JSON.parse(mol.get_json());
  const molecule = json.molecules[0];
  molecule.conformers = [{ dim: 2, coords: layout.atoms.map(({ x, y }) => [x, y]) }];
  const withCoords = parseMol(rdkit, JSON.stringify(json));
  if (!withCoords) return null;

  let molblock = withCoords.get_molblock();
  withCoords.delete();
  const stereoBonds: number[] = (molecule.bonds ?? []).flatMap(
    (bond: { stereo?: string }, index: number) =>
      bond.stereo === "cis" || bond.stereo === "trans" ? [index] : [],
  );
  if (stereoBonds.length && !molblock.includes("V3000")) {
    const lines = molblock.split("\n");
    const atomCount = parseInt(lines[3].slice(0, 3), 10);
    for (const index of stereoBonds) {
      const line = 4 + atomCount + index;
      lines[line] = `${lines[line].slice(0, 9)}  0${lines[line].slice(12)}`;
    }
    molblock = lines.join("\n");
  }

  const result = parseMol(rdkit, molblock);
  if (!result || result.get_smiles() !== mol.get_smiles()) {
    result?.delete();
    return null;
  }
  return result;
}

export function loadTemplates(
  rdkit: RDKitModule,
  templates: ScaffoldTemplate[] = SCAFFOLD_TEMPLATES,
): LoadedTemplate[] {
  return templates.flatMap((template) => {
    const molblock = templateMolblock(template);
    const mol = parseMol(rdkit, molblock);
    return mol ? [{ name: template.name, mol, layout: parseMolblock(molblock) }] : [];
  });
}

function substructMatches(mol: JSMol, query: JSMol): number[][] {
  const parsed = JSON.parse(mol.get_substruct_matches(query) || "[]");
  if (!Array.isArray(parsed)) return [];
  // The same atoms can match in several orders (symmetry); keep one of each.
  const unique = new Map<string, number[]>();
  for (const { atoms } of parsed as { atoms: number[] }[]) {
    const key = [...atoms].sort((a, b) => a - b).join(",");
    if (!unique.has(key)) unique.set(key, atoms);
  }
  return [...unique.values()];
}

type ScaffoldMatch = { template: LoadedTemplate; atoms: number[] };

/**
 * Sets of non-overlapping scaffold matches to lay out together. Matches
 * overlap when templates nest (every epoxymorphinan is also a morphinan) or a
 * cage is symmetric (buprenorphine's extra bridge can play the part of either
 * ring), so each seed match yields a different set. Earlier templates are
 * more specific and win when matches overlap.
 */
function matchAssignments(matches: ScaffoldMatch[], limit = 3): ScaffoldMatch[][] {
  const assignments: ScaffoldMatch[][] = [];
  const seen = new Set<string>();
  for (const seed of matches) {
    if (assignments.length >= limit) break;
    const used = new Set(seed.atoms);
    const chosen = [seed];
    for (const match of matches) {
      if (match === seed || match.atoms.some((atom) => used.has(atom))) continue;
      chosen.push(match);
      match.atoms.forEach((atom) => used.add(atom));
    }
    const key = chosen
      .map(({ template, atoms }) => `${template.name}:${[...atoms].sort((a, b) => a - b)}`)
      .sort()
      .join("|");
    if (!seen.has(key)) {
      seen.add(key);
      assignments.push(chosen);
    }
  }
  return assignments;
}

/** Find the cleanest 2D layout for a valid SMILES. The caller owns `mol`. */
export function layoutMolecule(
  rdkit: RDKitModule,
  smiles: string,
  templates: LoadedTemplate[],
): LayoutResult | null {
  const candidates: Candidate[] = [];
  const add = (
    mol: JSMol | null,
    strategy: string,
    fromTemplate = false,
    scored?: { layout: Layout; score: LayoutScore },
  ) => {
    if (!mol) return;
    const layout = scored?.layout ?? parseMolblock(mol.get_molblock());
    candidates.push({
      mol,
      strategy,
      layout,
      score: scored?.score ?? scoreLayout(layout),
      fromTemplate,
      refined: Boolean(scored),
    });
  };
  const freshLayout = (input: string, useCoordGen: boolean) => {
    const mol = parseMol(rdkit, input);
    mol?.set_new_coords(useCoordGen);
    return mol;
  };
  const isGoodEnough = () =>
    candidates.some((candidate) => candidate.score.score < GOOD_ENOUGH_SCORE);

  add(freshLayout(smiles, true), "coordgen");
  if (!candidates.length) return null;
  const atomCount = candidates[0].layout.atoms.length;

  if (!isGoodEnough() && atomCount <= MAX_SEARCH_ATOMS) {
    add(freshLayout(smiles, false), "native");

    const base = parseMol(rdkit, smiles)!;
    try {
      const matches: ScaffoldMatch[] = templates.flatMap((template) =>
        substructMatches(base, template.mol).map((atoms) => ({ template, atoms })),
      );

      // RDKit's own template alignment: clean when it works, but it aligns
      // only one match and only honours templates in the native depictor.
      for (const template of new Set(matches.map((match) => match.template))) {
        const aligned = parseMol(rdkit, smiles);
        if (
          aligned?.generate_aligned_coords(
            template.mol,
            JSON.stringify({ useCoordGen: false, acceptFailure: false }),
          )
        ) {
          add(aligned, `template:${template.name}:aligned`, true);
        } else {
          aligned?.delete();
        }
      }

      // Assemble every match in its template shape, keeping the rest of the
      // molecule in the shape CoordGen or the native depictor drew it.
      const rawLayouts = candidates.slice(0, 2).map((candidate) => candidate.layout);
      for (const assignment of matchAssignments(matches)) {
        const name = [...new Set(assignment.map((match) => match.template.name))].join("+");
        rawLayouts.forEach((rawLayout, index) => {
          const unit = medianBondLength(rawLayout);
          const assembled = assembleScaffolds(
            rawLayout,
            assignment.map(({ template, atoms }) => {
              const scale = unit / medianBondLength(template.layout);
              return {
                atoms,
                points: template.layout.atoms.map(({ x, y }) => ({ x: x * scale, y: y * scale })),
              };
            }),
          );
          add(
            withCoordinates(rdkit, base, assembled.layout),
            `template:${name}${index ? ":native" : ""}`,
            true,
            assembled,
          );
        });
      }

      // The native depictor depends on atom order; CoordGen doesn't.
      const orderings = new Set([smiles]);
      for (let k = 0; k < ALTERNATE_ORDERINGS; k++) {
        const root = Math.floor(((k + 0.5) * atomCount) / ALTERNATE_ORDERINGS);
        const reordered = (base.get_smiles as (details?: string) => string)(
          JSON.stringify({ rootedAtAtom: root, canonical: false }),
        );
        if (orderings.has(reordered)) continue;
        orderings.add(reordered);
        add(freshLayout(reordered, false), "native:reordered");
      }
    } finally {
      base.delete();
    }

    const byScore = () => candidates.sort((a, b) => a.score.score - b.score.score);
    byScore();
    if (candidates[0].score.score >= 1) {
      for (const candidate of candidates
        .filter((c) => !c.refined)
        .slice(0, REPAIRED_CANDIDATES)) {
        const repaired = repairLayout(candidate.layout);
        if (repaired.score.score >= candidate.score.score) continue;
        add(
          withCoordinates(rdkit, candidate.mol, repaired.layout),
          `${candidate.strategy}+cleanup`,
          candidate.fromTemplate,
          repaired,
        );
      }
    }
    byScore();
  }

  let best = candidates[0];
  const bestTemplate = candidates.find((candidate) => candidate.fromTemplate);
  if (bestTemplate && bestTemplate.score.score <= best.score.score + TEMPLATE_PREFERENCE) {
    best = bestTemplate;
  }
  for (const candidate of candidates) {
    if (candidate !== best) candidate.mol.delete();
  }

  // Canonical landscape orientation; doesn't change the defect score.
  best.mol.normalize_depiction(1);
  best.mol.straighten_depiction();
  return { mol: best.mol, strategy: best.strategy, score: best.score };
}

/** Stateful renderer holding the scaffold templates and a small layout cache. */
export function createDepicter(rdkit: RDKitModule) {
  const templates = loadTemplates(rdkit);
  const cache = new Map<string, LayoutResult>();

  const cachedLayout = (smiles: string) => {
    const hit = cache.get(smiles);
    if (hit) {
      // Refresh recency.
      cache.delete(smiles);
      cache.set(smiles, hit);
      return hit;
    }
    const result = layoutMolecule(rdkit, smiles, templates);
    if (!result) return null;
    cache.set(smiles, result);
    if (cache.size > LAYOUT_CACHE_SIZE) {
      const [oldestKey, oldest] = cache.entries().next().value!;
      cache.delete(oldestKey);
      oldest.mol.delete();
    }
    return result;
  };

  /**
   * Render the first cleanup candidate RDKit accepts, or null when none parse.
   * Re-rendering the same SMILES reuses its layout.
   */
  const render = (input: string, options: RenderOptions): RenderedMolecule | null => {
    for (const candidate of makeSmilesCandidates(input)) {
      try {
        const layout = cachedLayout(candidate.value);
        if (!layout) continue;

        const svg = layout.mol.get_svg_with_highlights(
          JSON.stringify({ ...DRAW_OPTIONS, addStereoAnnotation: options.stereoLabels }),
        );
        if (!svg) continue;
        return {
          smiles: candidate.value,
          fixes: candidate.fixes,
          canonicalSmiles: layout.mol.get_smiles(),
          svg,
          layout: { strategy: layout.strategy, score: layout.score.score },
        };
      } catch {
        continue;
      }
    }
    return null;
  };

  return { render };
}

export type Depicter = ReturnType<typeof createDepicter>;
