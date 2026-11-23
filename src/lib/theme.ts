/**
 * Dashboard appearance preferences.
 *
 * The dashboard is the only surface that uses these values: marketing and
 * public pages keep their own palettes. The pure helpers live here so the
 * inline first-paint script and the React toggle cannot disagree.
 */

export const THEME_STORAGE_KEY = "herald-dashboard-theme";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (THEME_MODES as readonly string[]).includes(value);
}

export function resolveThemeMode(mode: ThemeMode, systemPrefersDark: boolean): "light" | "dark" {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode;
}

/** The inline script in the root layout; kept as a string in one place. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}");if(m!=="light"&&m!=="dark"&&m!=="system")m="system";var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var a=location.pathname==="/app"||location.pathname.indexOf("/app/")===0;document.documentElement.classList.toggle("dark",d&&a);}catch(e){}})();`;
