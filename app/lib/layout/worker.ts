/// <reference lib="webworker" />
// Rendering worker: owns the RDKit WebAssembly module and runs the layout
// search off the main thread so big molecules don't freeze the canvas.
import type { RDKitModule } from "@rdkit/rdkit";
import { createDepicter, type RenderOptions } from "./depict.ts";

export type RenderRequest = {
  id: number;
  input: string;
  options: RenderOptions;
};

export type WorkerMessage =
  | { type: "ready" }
  | { type: "init-error"; message: string }
  | {
      type: "result";
      id: number;
      result: ReturnType<ReturnType<typeof createDepicter>["render"]>;
    }
  | { type: "error"; id: number; message: string };

type RDKitLoader = (options: { locateFile: () => string }) => Promise<RDKitModule>;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerMessage) => scope.postMessage(message);

async function loadRDKit(): Promise<RDKitModule> {
  // RDKit_minimal.js is a classic script that declares a global loader, and
  // module workers can't importScripts, so evaluate it and take the loader.
  const response = await fetch("/rdkit/RDKit_minimal.js");
  if (!response.ok) throw new Error(`RDKit script: HTTP ${response.status}`);
  const source = await response.text();
  const initRDKitModule = new Function(`${source}\nreturn initRDKitModule;`)() as RDKitLoader;
  const rdkit = await initRDKitModule({ locateFile: () => "/rdkit/RDKit_minimal.wasm" });
  rdkit.prefer_coordgen(true);
  return rdkit;
}

const depicterPromise = loadRDKit().then(createDepicter);

depicterPromise.then(
  () => post({ type: "ready" }),
  (error: unknown) => post({ type: "init-error", message: String(error) }),
);

scope.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const { id, input, options } = event.data;
  try {
    const depicter = await depicterPromise;
    post({ type: "result", id, result: depicter.render(input, options) });
  } catch (error) {
    post({ type: "error", id, message: String(error) });
  }
};
