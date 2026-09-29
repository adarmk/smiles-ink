import type { Theme } from "../lib/types";

type TopbarProps = {
  theme: Theme;
  onToggleTheme: () => void;
  hasMolecules: boolean;
  onClear: () => void;
};

export function Topbar({
  theme,
  onToggleTheme,
  hasMolecules,
  onClear,
}: TopbarProps) {
  const themeLabel = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;

  return (
    <header className="topbar">
      <div className="brand" aria-label="smiles.ink">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-word">smiles.ink</span>
        <span className="brand-divider" aria-hidden="true" />
        <span className="brand-subtitle">SMILES canvas</span>
      </div>

      <div className="topbar-actions">
        <a
          className="x-link"
          href="https://x.com/adarkahiri"
          target="_blank"
          rel="noreferrer"
          title="@adarkahiri on X"
          aria-label="Follow @adarkahiri on X"
        >
          <span className="x-mark" aria-hidden="true">
            𝕏
          </span>
        </a>
        <button
          className="theme-toggle"
          type="button"
          onClick={onToggleTheme}
          title={themeLabel}
          aria-label={themeLabel}
          aria-pressed={theme === "dark"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
        </button>
        {hasMolecules && (
          <button
            className="clear-button"
            type="button"
            onClick={onClear}
            title="Clear canvas (⌘X)"
            aria-keyshortcuts="Meta+X Control+X"
          >
            <span className="clear-label">Clear canvas</span>
            <span className="clear-icon" aria-hidden="true">
              ×
            </span>
            <kbd aria-hidden="true">⌘X</kbd>
          </button>
        )}
      </div>
    </header>
  );
}
