// Serialization for the locally saved canvas. Depictions are not stored: each
// molecule is re-rendered from its SMILES on load, which keeps storage small and
// lets rendering improvements apply to previously saved canvases.
import type { CanvasTransform, MoleculeItem } from "./types";

export const CANVAS_STORAGE_KEY = "smiles-ink-canvas";
const CANVAS_STORAGE_VERSION = 1;

export type SavedMolecule = Omit<MoleculeItem, "svg" | "canonicalSmiles">;

export type SavedCanvas = {
  molecules: SavedMolecule[];
  transform: CanvasTransform;
};

export function serializeCanvas(
  molecules: readonly MoleculeItem[],
  transform: CanvasTransform,
): string {
  return JSON.stringify({
    version: CANVAS_STORAGE_VERSION,
    transform,
    molecules: molecules.map(
      ({ svg, canonicalSmiles, ...saved }) => saved,
    ),
  });
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function parseMolecule(value: unknown): SavedMolecule | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.smiles !== "string" ||
    !item.smiles ||
    !isFiniteNumber(item.x) ||
    !isFiniteNumber(item.y) ||
    !isFiniteNumber(item.width) ||
    !isFiniteNumber(item.height) ||
    item.width <= 0 ||
    item.height <= 0 ||
    !isFiniteNumber(item.rotation) ||
    !isFiniteNumber(item.zIndex)
  ) {
    return null;
  }

  return {
    id: item.id,
    smiles: item.smiles,
    x: item.x,
    y: item.y,
    width: item.width,
    height: item.height,
    rotation: item.rotation,
    flippedHorizontally: item.flippedHorizontally === true,
    flippedVertically: item.flippedVertically === true,
    stereoLabels: item.stereoLabels === true,
    zIndex: item.zIndex,
  };
}

function parseTransform(value: unknown): CanvasTransform | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, scale } = value as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(scale)) {
    return null;
  }
  return scale > 0 ? { x, y, scale } : null;
}

/** Parse saved canvas JSON, dropping anything malformed. Never throws. */
export function parseSavedCanvas(raw: string | null): SavedCanvas | null {
  if (!raw) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const { version, molecules, transform } = data as Record<string, unknown>;
  if (version !== CANVAS_STORAGE_VERSION || !Array.isArray(molecules)) {
    return null;
  }

  const seenIds = new Set<string>();
  const parsedMolecules = molecules
    .map(parseMolecule)
    .filter((molecule): molecule is SavedMolecule => {
      if (!molecule || seenIds.has(molecule.id)) return false;
      seenIds.add(molecule.id);
      return true;
    });

  return {
    molecules: parsedMolecules,
    transform: parseTransform(transform) ?? { x: 0, y: 0, scale: 1 },
  };
}
