export const THEME_STORAGE_KEY = "unimarket_theme";

export type ThemeMode = "dark" | "light";

const isThemeMode = (value: string | null): value is ThemeMode => {
  return value === "dark" || value === "light";
};

export const readStoredTheme = (): ThemeMode => {
  if (typeof window === "undefined") {
    return "dark";
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
};

export const applyTheme = (theme: ThemeMode): void => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
};

export const persistTheme = (theme: ThemeMode): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage restrictions and keep runtime theme behavior.
  }
};

export const initializeTheme = (): ThemeMode => {
  const theme = readStoredTheme();
  persistTheme(theme);
  applyTheme(theme);
  return theme;
};
