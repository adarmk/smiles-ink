import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Drawchem canvas", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Drawchem — SMILES canvas<\/title>/i);
  assert.match(html, /Paste a SMILES string/i);
  assert.match(html, /SMILES canvas/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("ships the chemistry engine as local application assets", async () => {
  const [javascript, wasm, packageSource] = await Promise.all([
    stat(new URL("../public/rdkit/RDKit_minimal.js", import.meta.url)),
    stat(new URL("../public/rdkit/RDKit_minimal.wasm", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.ok(javascript.size > 100_000);
  assert.ok(wasm.size > 1_000_000);
  assert.match(packageSource, /"@rdkit\/rdkit"/);
});

test("includes the requested canvas interactions", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /startDrag/);
  assert.match(source, /startResize/);
  assert.match(source, /rotation: molecule\.rotation \+ 15/);
  assert.match(source, /removeMolecule/);
  assert.match(source, /window\.addEventListener\("paste"/);
  assert.match(source, /prefer_coordgen\(true\)/);
  assert.match(source, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "x"/);
  assert.match(source, /padding: 0\.025/);
});

test("repairs common pasted SMILES formatting without changing chemistry", async () => {
  const { makeSmilesCandidates, splitSmilesInput } = await import(
    "../app/smiles-cleanup.ts"
  );

  assert.equal(makeSmilesCandidates(" C C O ")[0].value, "CCO");
  assert.equal(makeSmilesCandidates("SMILES: CC(=O)O")[0].value, "CC(=O)O");
  assert.equal(makeSmilesCandidates("\u200BCCO\uFEFF")[0].value, "CCO");
  assert.equal(makeSmilesCandidates("CC[Na]·Cl")[0].value, "CC[Na].Cl");
  assert.equal(makeSmilesCandidates("\"CCO\"")[0].value, "CCO");
  assert.equal(makeSmilesCandidates("CCO,")[1].value, "CCO");
  assert.equal(makeSmilesCandidates("CCO ethanol")[1].value, "CCO");
  assert.equal(makeSmilesCandidates("CC(=O)\nOc1ccccc1")[0].value, "CC(=O)Oc1ccccc1");
  assert.deepEqual(splitSmilesInput("CC(=O)\nOc1ccccc1"), [
    "CC(=O)\nOc1ccccc1",
  ]);
  assert.deepEqual(splitSmilesInput("CCO\n\nCCN"), ["CCO", "CCN"]);
});
