import type { Depiction, RenderOptions } from "./renderer";
import type { Box, MoleculeItem } from "./types";

export const CANVAS_URL_PARAM = "molecules";
export const MAX_URL_MOLECULES = 100;
export const MAX_CANVAS_URL_LENGTH = 64_000;

export type UrlMolecule = Box & { smiles: string };

function invalid(message: string): never {
  throw new Error(`Invalid canvas URL: ${message}`);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= 1_000_000;
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    value > 0 && value <= 10_000;
}

/**
 * One JSON array keeps each SMILES coupled to its layout. URLSearchParams does
 * the only decoding pass (important for +, #, %, / and \\ in SMILES).
 * null means no import; [] is an intentional empty canvas.
 */
export function parseCanvasUrl(search: string): UrlMolecule[] | null {
  const params = new URLSearchParams(search);
  if (!params.has(CANVAS_URL_PARAM)) return null;
  if (params.getAll(CANVAS_URL_PARAM).length !== 1) {
    invalid("use one molecules parameter containing an array.");
  }
  const raw = params.get(CANVAS_URL_PARAM)!;
  if (raw.length > MAX_CANVAS_URL_LENGTH) invalid("payload is too large.");

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    invalid("molecules must be a JSON array.");
  }
  if (!Array.isArray(data) || data.length > MAX_URL_MOLECULES) {
    invalid(`provide an array of at most ${MAX_URL_MOLECULES} molecules.`);
  }
  return data.map((value: unknown, index): UrlMolecule => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(`molecule ${index + 1} must be an object.`);
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.smiles !== "string" || !item.smiles.trim() ||
      !isCoordinate(item.x) || !isCoordinate(item.y) ||
      !isSize(item.width) || !isSize(item.height)
    ) {
      invalid(`molecule ${index + 1} needs SMILES, finite x/y and positive width/height within the supported limits.`);
    }
    return {
      smiles: item.smiles.trim(),
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    };
  });
}

type Render = (
  smiles: string,
  options: RenderOptions,
) => Promise<Pick<Depiction, "smiles" | "canonicalSmiles" | "svg"> | null>;

/** Prepare the entire replacement before committing any canvas changes. */
export async function renderCanvasUrl(
  entries: readonly UrlMolecule[],
  render: Render,
  makeId: () => string,
): Promise<MoleculeItem[]> {
  return Promise.all(entries.map(async (entry, index) => {
    const depiction = await render(entry.smiles, { stereoLabels: false });
    if (!depiction) invalid(`molecule ${index + 1} is not valid SMILES.`);
    return {
      ...entry,
      smiles: depiction.smiles,
      canonicalSmiles: depiction.canonicalSmiles,
      svg: depiction.svg,
      id: makeId(),
      rotation: 0,
      flippedHorizontally: false,
      flippedVertically: false,
      stereoLabels: false,
      zIndex: index + 1,
    };
  }));
}
