// Curated 2D layouts for ring systems that automatic layout gets wrong.
// Coordinates are textbook-style drawings; bonds are "any" bonds so a template
// matches regardless of bond order or aromaticity. To add a scaffold, add an
// entry and a molecule that contains it to tests/rendering.

export type ScaffoldTemplate = {
  name: string;
  atoms: { element: string; x: number; y: number }[];
  /** 1-based atom index pairs. */
  bonds: [number, number][];
};

/**
 * 4,5-Epoxymorphinan (morphine, naltrexone, naltrindole, buprenorphine…).
 * Derived from PubChem's 2D depiction of morphine, then relaxed.
 */
const EPOXYMORPHINAN: ScaffoldTemplate = {
  name: "epoxymorphinan",
  atoms: [
    { element: "O", x: 2.3655, y: -0.0131 },
    { element: "N", x: 6.1605, y: -0.823 },
    { element: "C", x: 3.9137, y: -0.4034 },
    { element: "C", x: 4.5046, y: -1.1422 },
    { element: "C", x: 5.2755, y: -0.6905 },
    { element: "C", x: 2.9649, y: -0.7514 },
    { element: "C", x: 4.773, y: 0.0577 },
    { element: "C", x: 3.7356, y: 0.4995 },
    { element: "C", x: 5.3176, y: 0.5881 },
    { element: "C", x: 5.9535, y: 0.0759 },
    { element: "C", x: 4.5202, y: 1.0609 },
    { element: "C", x: 2.7749, y: -1.6571 },
    { element: "C", x: 4.3516, y: -2.0512 },
    { element: "C", x: 2.8643, y: 0.789 },
    { element: "C", x: 3.4463, y: -2.351 },
    { element: "C", x: 4.3719, y: 1.9945 },
    { element: "C", x: 2.7181, y: 1.7208 },
    { element: "C", x: 3.4774, y: 2.3181 },
  ],
  bonds: [
    [6, 1], [1, 14], [2, 5], [2, 10], [3, 4], [3, 6], [3, 7], [3, 8],
    [4, 5], [4, 13], [5, 9], [6, 12], [7, 10], [8, 11], [8, 14], [9, 11],
    [11, 16], [12, 15], [13, 15], [14, 17], [16, 18], [17, 18],
  ],
};

/** Remove one atom (1-based) and its bonds from a template, renumbering the rest. */
function withoutAtom(template: ScaffoldTemplate, name: string, atom: number): ScaffoldTemplate {
  const renumber = (i: number) => (i > atom ? i - 1 : i);
  return {
    name,
    atoms: template.atoms.filter((_, index) => index + 1 !== atom),
    bonds: template.bonds
      .filter(([a, b]) => a !== atom && b !== atom)
      .map(([a, b]) => [renumber(a), renumber(b)]),
  };
}

/** Morphinan without the 4,5-ether bridge (levorphanol, dextromethorphan…). */
const MORPHINAN = withoutAtom(EPOXYMORPHINAN, "morphinan", 1);

/** Most specific first: when several match, earlier templates win ties. */
export const SCAFFOLD_TEMPLATES: ScaffoldTemplate[] = [EPOXYMORPHINAN, MORPHINAN];

/** V2000 molblock for a template, with every bond as an "any" (type 8) query bond. */
export function templateMolblock(template: ScaffoldTemplate) {
  const pad = (value: number | string, width: number) => String(value).padStart(width);
  const header = `\n  ${template.name}\n\n${pad(template.atoms.length, 3)}${pad(template.bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000\n`;
  const atoms = template.atoms
    .map(
      ({ element, x, y }) =>
        `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}    0.0000 ${element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0\n`,
    )
    .join("");
  const bonds = template.bonds
    .map(([a, b]) => `${pad(a, 3)}${pad(b, 3)}  8  0\n`)
    .join("");
  return `${header}${atoms}${bonds}M  END\n`;
}
