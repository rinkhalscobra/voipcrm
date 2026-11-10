"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import type { ThemePreference } from "@/lib/theme";

export function ThemeToggle() {
  const { resolvedTheme, setTheme, ready } = useTheme();
  const label =
    resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      disabled={!ready}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun size={17} className="theme-sun" aria-hidden="true" />
      <Moon size={17} className="theme-moon" aria-hidden="true" />
    </button>
  );
}

export function ThemePicker() {
  const { preference, setTheme, ready } = useTheme();
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;
  return (
    <section className="panel settings-panel appearance-panel">
      <h2>Appearance</h2>
      <p>
        Choose a theme for this browser. System follows your device setting.
      </p>
      <div className="theme-options" role="group" aria-label="Color theme">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className="theme-option"
            aria-pressed={preference === value}
            disabled={!ready}
            onClick={() => setTheme(value as ThemePreference)}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
