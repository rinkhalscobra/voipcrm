export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export const themeStorageKey = "voixel.theme";

export function themePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

// Runs before the page content is parsed, so a saved light theme never paints
// the dark interface first. No account data or credentials are stored here.
export const themeBootstrap = `(()=>{let p="system";try{const v=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(v==="light"||v==="dark")p=v}catch{}const t=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;const r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t})()`;
