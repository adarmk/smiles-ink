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
- Saves the canvas in your browser (`localStorage`) so it survives a reload. Molecules are stored as SMILES plus layout and re-rendered on load.
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
bun run test        # build, then unit + server-render tests (requires Node 22+)
bun run test:unit   # fast unit tests only, no build
bun run test:rendering  # layout regression tests with the real RDKit build
bun run lint
```

## Code layout

- `app/page.tsx` — the canvas page; composes the pieces below.
- `app/components/` — the top bar, molecule card (with its selection toolbar), and the input docks.
- `app/hooks/` — canvas pan/zoom/pinch, molecule drag/resize/rotate, local persistence, notices.
- `app/lib/` — pure geometry, persistence parsing, theme handling, and the rendering worker client.
- `app/lib/layout/` — the rendering worker and the layout search: scoring, cleanup, scaffold templates.
- `app/smiles-cleanup.ts` — conservative repair of pasted SMILES.

## Deploy to Cloudflare Workers

Use `bun run build` as the build command and `bun run deploy` as the deploy
command. The build command installs the locked dependencies first so it also
works when the host skips automatic dependency installation.

## Rendering approach

[RDKit.js](https://github.com/rdkit/rdkit-js) (the official WebAssembly build of RDKit) parses SMILES, generates 2D coordinates, and draws SVG. It runs in a Web Worker so large molecules never freeze the canvas.

Automatic 2D layout is unreliable for bridged polycycles: CoordGen draws every morphinan with overlapping atoms and bonds running through atoms, whatever the atom order. So when the first layout has visible defects, smiles.ink searches instead of trusting it (`app/lib/layout/`):

1. **Score** each layout for defects in plain JS: crossing bonds, overlapping or crowded atoms, atoms on bonds, substituents inside rings, squashed rings, uneven bonds (`score.ts`).
2. **Generate candidates**: CoordGen, RDKit's native depictor, the native depictor on several atom orderings, and curated **scaffold templates** (`templates.ts`) aligned with `generate_aligned_coords` and then snapped onto every copy of the scaffold, e.g. both halves of a bivalent ligand. Short ring bridges the template doesn't cover are laid out by trying a range of curves (`refine.ts`).
3. **Clean up** the best candidates by mirroring substituents and a small force-directed relaxation, keeping only changes that lower the score.
4. **Keep the best**, preferring a template layout when one matches. New coordinates are applied only if the canonical isomeric SMILES is unchanged, so stereochemistry is never altered.

Ordinary molecules are clean on the first try and skip the search entirely. Drawings omit explicit H at stereocentres (wedges carry the stereo), and CIP (R)/(S) labels are off by default; toggle them per molecule with the **R/S** button.

To fix a scaffold that still draws badly, add a template to `app/lib/layout/templates.ts` and the molecule to `tests/rendering/molecules.mjs`. `bun run test:rendering` fails if any listed molecule's layout gets worse.
