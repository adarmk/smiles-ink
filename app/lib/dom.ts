import { computeCanvasBounds, INITIAL_CANVAS_TRANSFORM } from "./geometry";
import type { CanvasTransform } from "./types";

export function isTextEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable ||
      target.closest("[contenteditable='true']") !== null)
  );
}

export function hasSelectedTextInEditor(target: EventTarget | null) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return (
      target.selectionStart !== null &&
      target.selectionEnd !== null &&
      target.selectionStart !== target.selectionEnd
    );
  }

  return isTextEditingTarget(target);
}

/** Canvas bounds measured from the live stage and whichever dock is visible. */
export function getCanvasBounds(
  ratio = 1.5,
  transform: CanvasTransform = INITIAL_CANVAS_TRANSFORM,
) {
  const stage = document.querySelector<HTMLElement>(".canvas-stage");
  const dock = Array.from(
    document.querySelectorAll<HTMLElement>(".canvas-dock"),
  ).find((element) => element.getClientRects().length > 0);
  const stageRect = stage?.getBoundingClientRect();

  return computeCanvasBounds(
    {
      width: stageRect?.width ?? window.innerWidth,
      height: stageRect?.height ?? window.innerHeight,
      dockTop:
        stageRect && dock
          ? dock.getBoundingClientRect().top - stageRect.top
          : null,
    },
    ratio,
    transform,
  );
}

export function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
