// Main-thread client for the rendering worker (see layout/worker.ts).
import type { RenderedMolecule, RenderOptions } from "./layout/depict";
import type { RenderRequest, WorkerMessage } from "./layout/worker";
// Vite's ?worker import bundles the worker and gives it a correct URL.
// (`new URL(…, import.meta.url)` doesn't survive vinext's import.meta rewriting.)
import RendererWorker from "./layout/worker.ts?worker";

export type { RenderOptions };
export type Depiction = RenderedMolecule;

type Pending = {
  resolve: (result: RenderedMolecule | null) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
const pending = new Map<number, Pending>();
let nextRequestId = 1;

function startWorker(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    const fail = (message: string) => {
      const error = new Error(message);
      worker?.terminate();
      worker = null;
      // Allow a later call to try again.
      readyPromise = null;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      reject(error);
    };

    try {
      worker = new RendererWorker({ name: "smiles-ink-renderer" });
    } catch (error) {
      fail(String(error));
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        resolve();
      } else if (message.type === "init-error") {
        fail(message.message);
      } else {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.type === "result") request?.resolve(message.result);
        else request?.reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => fail(event.message || "Renderer failed");
  });

  return readyPromise;
}

/** Resolves once the renderer is running; rejects if it can't start. */
export function whenRendererReady() {
  return startWorker();
}

/** Make RDKit's SVG scale to its container and hide it from assistive tech. */
function prepareSvg(svgSource: string) {
  const svg = new DOMParser().parseFromString(svgSource, "image/svg+xml").documentElement;
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg.outerHTML;
}

/**
 * Render pasted SMILES (after conservative cleanup) to an SVG depiction.
 * Resolves to null when the input isn't valid SMILES.
 */
export async function renderSmiles(
  input: string,
  options: RenderOptions,
): Promise<Depiction | null> {
  await startWorker();
  const id = nextRequestId++;
  const result = await new Promise<RenderedMolecule | null>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, input, options } satisfies RenderRequest);
  });
  return result ? { ...result, svg: prepareSvg(result.svg) } : null;
}
