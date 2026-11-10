"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  resolveTheme,
  themePreference,
  themeStorageKey,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  ready: boolean;
  setTheme: (theme: ThemePreference) => void;
}
const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => {
      meta.removeAttribute("media");
      meta.content = theme === "dark" ? "#0c0e16" : "#f5f6fb";
    });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [ready, setReady] = useState(false);
  const preferenceRef = useRef<ThemePreference>("system");
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let saved: ThemePreference = "system";
    try {
      saved = themePreference(localStorage.getItem(themeStorageKey));
    } catch {
      /* Storage can be disabled; the controls still work. */
    }
    const update = (value: ThemePreference) => {
      preferenceRef.current = value;
      setPreference(value);
      setSystemDark(media.matches);
      applyTheme(resolveTheme(value, media.matches));
    };
    update(saved);
    setReady(true);
    const onSystemChange = () => update(preferenceRef.current);
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null)
        update(themePreference(event.newValue));
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const setTheme = useCallback((value: ThemePreference) => {
    preferenceRef.current = value;
    setPreference(value);
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setSystemDark(dark);
    applyTheme(resolveTheme(value, dark));
    try {
      localStorage.setItem(themeStorageKey, value);
    } catch {
      /* Keep the selection in memory when storage is unavailable. */
    }
  }, []);
  return (
    <ThemeContext.Provider
      value={{
        preference,
        resolvedTheme: resolveTheme(preference, systemDark),
        ready,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is required");
  return context;
}
