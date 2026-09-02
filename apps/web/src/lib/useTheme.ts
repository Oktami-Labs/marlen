import type { AccentColorPreference, AppearancePreference } from "@marlen/shared";
import * as React from "react";

export type ThemePref = AppearancePreference;

export const ACCENT_COLOR_PRESETS = [
  { id: "violet", labelKey: "settings.accentColor.violet" },
  { id: "blue", labelKey: "settings.accentColor.blue" },
  { id: "teal", labelKey: "settings.accentColor.teal" },
  { id: "rose", labelKey: "settings.accentColor.rose" },
  { id: "amber", labelKey: "settings.accentColor.amber" },
] as const satisfies readonly { id: AccentColorPreference; labelKey: string }[];

export type AccentColor = AccentColorPreference;

const STORAGE_KEY = "marlen-theme";
const ACCENT_COLOR_STORAGE_KEY = "marlen-accent-color";

function readPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "system";
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

// Cross-instance sync: every hook instance registers here and hears the
// others' pref writes without lifting state.
const prefListeners = new Set<(pref: ThemePref) => void>();
const accentColorListeners = new Set<(color: AccentColor) => void>();

function isAccentColor(value: string | null): value is AccentColor {
  return ACCENT_COLOR_PRESETS.some((preset) => preset.id === value);
}

function readAccentColor(): AccentColor {
  if (typeof window === "undefined") return "violet";
  const saved = localStorage.getItem(ACCENT_COLOR_STORAGE_KEY);
  return isAccentColor(saved) ? saved : "violet";
}

/** Apply a preference from either a mounted control or a live agent action. */
export function applyThemePreference(pref: ThemePref): void {
  if (typeof window === "undefined") return;
  const next = resolve(pref);
  document.documentElement.classList.toggle("dark", next === "dark");
  localStorage.setItem(STORAGE_KEY, pref);
  for (const listener of prefListeners) listener(pref);
}

export function applyAccentColor(color: AccentColor): void {
  if (typeof window === "undefined") return;
  document.documentElement.dataset.accentColor = color;
  localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, color);
  for (const listener of accentColorListeners) listener(color);
}

applyAccentColor(readAccentColor());

/**
 * Three-way theme preference (light/dark/system). Persists to localStorage
 * and broadcasts through a module listener set so every hook instance
 * (header toggle, Settings row) stays in sync without lifting state.
 */
export function useTheme() {
  const [pref, setPref] = React.useState<ThemePref>(readPref);
  const [resolved, setResolved] = React.useState<"light" | "dark">(() => resolve(readPref()));

  // Apply the resolved theme to <html>, persist the pref, and broadcast it.
  React.useEffect(() => {
    const next = resolve(pref);
    setResolved(next);
    applyThemePreference(pref);
  }, [pref]);

  // While following the system, keep resolving live as the OS setting changes.
  React.useEffect(() => {
    if (pref !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mql.matches ? "dark" : "light";
      setResolved(next);
      document.documentElement.classList.toggle("dark", next === "dark");
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [pref]);

  // Cross-instance sync, another hook instance changed the pref.
  React.useEffect(() => {
    const listener = (next: ThemePref) => {
      if (next !== pref) setPref(next);
    };
    prefListeners.add(listener);
    return () => {
      prefListeners.delete(listener);
    };
  }, [pref]);

  return [pref, resolved, setPref] as const;
}

export function useAccentColor() {
  const [color, setColor] = React.useState<AccentColor>(readAccentColor);

  React.useEffect(() => {
    applyAccentColor(color);
  }, [color]);

  React.useEffect(() => {
    const listener = (next: AccentColor) => {
      if (next !== color) setColor(next);
    };
    accentColorListeners.add(listener);
    return () => {
      accentColorListeners.delete(listener);
    };
  }, [color]);

  return [color, setColor] as const;
}
