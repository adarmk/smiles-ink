import type { ClipboardEvent as ReactClipboardEvent } from "react";

type SmilesInputDockProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isRendering: boolean;
  isDisabled: boolean;
};

/** Desktop: a compact text field for typing or pasting SMILES. */
export function SmilesInputDock({
  value,
  onChange,
  onSubmit,
  isRendering,
  isDisabled,
}: SmilesInputDockProps) {
  const handlePaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;
    event.preventDefault();
    onChange(pasted);
    onSubmit(pasted);
  };

  return (
    <form
      className="smiles-dock canvas-dock"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="input-row">
        <span className="input-plus" aria-hidden="true">
          +
        </span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          placeholder="Paste SMILES…"
          aria-label="SMILES string"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button
          className="render-button"
          type="submit"
          aria-label={isRendering ? "Rendering molecule" : "Render molecule"}
          disabled={!value.trim() || isRendering || isDisabled}
        >
          <span>{isRendering ? "Rendering" : "Render"}</span>
          <span className="return-symbol" aria-hidden="true">
            ↵
          </span>
        </button>
      </div>
    </form>
  );
}

type MobileActionDockProps = {
  onPaste: () => void;
  onClear: () => void;
  isRendering: boolean;
  isPasteDisabled: boolean;
  isClearDisabled: boolean;
};

/** Mobile: paste-from-clipboard and clear buttons. */
export function MobileActionDock({
  onPaste,
  onClear,
  isRendering,
  isPasteDisabled,
  isClearDisabled,
}: MobileActionDockProps) {
  return (
    <div
      className="mobile-action-dock canvas-dock"
      role="group"
      aria-label="Canvas actions"
    >
      <button
        className="mobile-action-button mobile-paste-button"
        type="button"
        aria-label={
          isRendering ? "Rendering molecule" : "Paste SMILES from clipboard"
        }
        onClick={onPaste}
        disabled={isPasteDisabled}
      >
        <span aria-hidden="true">↧</span>
      </button>
      <button
        className="mobile-action-button mobile-clear-button"
        type="button"
        aria-label="Clear canvas"
        onClick={onClear}
        disabled={isClearDisabled}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
