# Drawchem

A private, local-first canvas for turning SMILES strings into publication-quality 2D molecular depictions.

## What it does

- Paste SMILES into the bottom field, or paste anywhere on the canvas.
- Automatically cleans common paste errors such as spaces, line breaks, hidden characters, Unicode dashes or dots, wrapping quotes, `SMILES:` labels, trailing punctuation, and trailing molecule names.
- Uses RDKit.js with CoordGen for chemical parsing and 2D coordinate generation.
- Renders crisp, resolution-independent SVG structures.
- Drag, resize, rotate, nudge, and delete molecules on an infinite-feeling canvas.
- Rejoins a SMILES string that was wrapped across several lines. To paste several different molecules at once, separate them with a blank line.
- Sends no molecule data to a server. The RDKit WebAssembly engine is served from `public/rdkit` and runs in the browser.

Cleanup is deliberately conservative: Drawchem only tries mechanical repairs that do not invent atoms, bonds, branches, charges, or stereochemistry.

## Run locally

```bash
pnpm install
pnpm dev
```

Then open `http://localhost:3000`.

## Validate

```bash
pnpm test
pnpm lint
```

## Rendering approach

[RDKit.js](https://github.com/rdkit/rdkit-js) is the official WebAssembly distribution of RDKit. Drawchem enables its [CoordGen](https://www.rdkit.org/docs/source/rdkit.Chem.rdCoordGen.html) coordinate generator, then uses RDKit's MolDraw2D SVG renderer with tuned line, font, centering, and padding settings. This keeps the depiction deterministic, chemically aware, fast, and fully local.
