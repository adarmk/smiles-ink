import { useCallback, useSyncExternalStore } from "react";
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from "./theme-script";
import type { Theme } from "./types";

const THEME_CHANGE_EVENT = "smiles-ink:theme-change";

function hasStoredTheme() {
  try {
    return Boolean(
      localStorage.getItem(THEME_STORAGE_KEY) ??
        localStorage.getItem(LEGACY_THEME_STORAGE_KEY),
    );
  } catch {
    return false;
  }
}

function getThemeSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function subscribeToTheme(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = () => onStoreChange();
  const handleSystemThemeChange = (event: MediaQueryListEvent) => {
    // An explicit choice wins over the system theme.
    if (hasStoredTheme()) return;
    document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    onStoreChange();
  };

  window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
  mediaQuery.addEventListener("change", handleSystemThemeChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    mediaQuery.removeEventListener("change", handleSystemThemeChange);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const toggleTheme = useCallback(() => {
    const nextTheme: Theme = getThemeSnapshot() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // The selected theme still applies for this session.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return { theme, toggleTheme };
}
