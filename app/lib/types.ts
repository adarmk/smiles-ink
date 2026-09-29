export type MoleculeItem = {
  id: string;
  smiles: string;
  canonicalSmiles: string;
  svg: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flippedHorizontally: boolean;
  flippedVertically: boolean;
  /** Show CIP (R)/(S) and (E)/(Z) labels. */
  stereoLabels: boolean;
  zIndex: number;
};

export type ResizeDirection = "nw" | "ne" | "sw" | "se";
export type Theme = "light" | "dark";
export type CanvasTransform = { x: number; y: number; scale: number };
export type NoticeTone = "neutral" | "error";

export type Box = { x: number; y: number; width: number; height: number };

export type CanvasBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  minWidth: number;
  maxWidth: number;
};
