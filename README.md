# smiles.ink

A private, local-first canvas for turning SMILES strings into publication-quality 2D molecular depictions.

## What it does

- On desktop, paste SMILES into the compact bottom input or anywhere on the canvas. On mobile, use the Paste action.
- Automatically cleans common paste errors such as spaces, line breaks, hidden characters, Unicode dashes or dots, wrapping quotes, `SMILES:` labels, trailing punctuation, and trailing molecule names.
- Uses RDKit.js with CoordGen for chemical parsing and 2D coordinate generation.
- Renders crisp, resolution-independent SVG structures.
- Drag, resize, rotate, flip horizontally or vertically, nudge, and delete molecules on an infinite-feeling canvas with light and dark themes.
- Select a molecule and press `⌘C` or `Ctrl+C` to copy its canonical SMILES string.
- Pan the canvas by dragging its empty space. Zoom with a mouse wheel or trackpad on desktop, or pinch on touch devices.
- Clear the canvas from the desktop header, with `⌘X` or `Ctrl+X`, or from the compact mobile controls.
- Rejoins a SMILES string that was wrapped across several lines. To paste several different molecules at once, separate them with a blank line.
- Sends no molecule data to a server. The RDKit WebAssembly engine is served from `public/rdkit` and runs in the browser.

Cleanup is deliberately conservative: smiles.ink only tries mechanical repairs that do not invent atoms, bonds, branches, charges, or stereochemistry.

## Run locally

```bash
bun install
bun dev
```

Then open `http://localhost:3000`.

## Validate

```bash
bun run test
bun run lint
```

## Deploy to Cloudflare Workers

Use `bun run build` as the build command and `bun run deploy` as the deploy
command. The build command installs the locked dependencies first so it also
works when the host skips automatic dependency installation.

## Rendering approach

[RDKit.js](https://github.com/rdkit/rdkit-js) is the official WebAssembly distribution of RDKit. smiles.ink enables its [CoordGen](https://www.rdkit.org/docs/source/rdkit.Chem.rdCoordGen.html) coordinate generator, then uses RDKit's MolDraw2D SVG renderer with tuned line, font, centering, and padding settings. This keeps the depiction deterministic, chemically aware, fast, and fully local.
