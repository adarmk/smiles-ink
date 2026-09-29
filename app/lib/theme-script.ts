// Shared by the server-rendered layout and the client theme hook, so it must
// not import client-only React APIs.
export const THEME_STORAGE_KEY = "smiles-ink-theme";
/** Key used before the drawchem → smiles.ink rename; still read as a fallback. */
export const LEGACY_THEME_STORAGE_KEY = "drawchem-theme";

/**
 * Runs in <head> before first paint so the stored or system theme applies
 * without a flash. Keep the storage keys in sync with the constants above.
 */
export const themeBootScript = `
(() => {
  try {
    const stored =
      localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) ??
      localStorage.getItem(${JSON.stringify(LEGACY_THEME_STORAGE_KEY)});
    const theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = theme;
  } catch {}
})();`;
