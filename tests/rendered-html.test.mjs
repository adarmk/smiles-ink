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

test("server-renders the smiles.ink canvas", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>smiles\.ink — SMILES canvas<\/title>/i);
  assert.match(html, /Paste a SMILES string/i);
  assert.match(html, /SMILES canvas/i);
  assert.match(html, /Switch to dark mode/i);
  assert.match(html, /smiles-ink-theme/i);
  assert.doesNotMatch(html, /RDKit · local/i);
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
