import { persistUiPreferences } from "@/lib/ui-preferences-store";

export const UI_ACCENT_KEY = "litera.uiAccent";

/** index.css holds each accent's light and dark values, keyed by `data-accent`. */
export const UI_ACCENTS = ["cobalt", "violet", "pine", "amber", "graphite"] as const;
export type UiAccent = (typeof UI_ACCENTS)[number];
export const DEFAULT_UI_ACCENT: UiAccent = "cobalt";

export function parseUiAccent(value: unknown): UiAccent {
  return UI_ACCENTS.includes(value as UiAccent) ? (value as UiAccent) : DEFAULT_UI_ACCENT;
}

export function loadUiAccent(): UiAccent {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_UI_ACCENT;
    return parseUiAccent(localStorage.getItem(UI_ACCENT_KEY));
  } catch {
    return DEFAULT_UI_ACCENT;
  }
}

export function cacheUiAccent(accent: UiAccent): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(UI_ACCENT_KEY, parseUiAccent(accent));
  } catch {
    // Storage is unavailable: the accent still applies for this run.
  }
}

export function saveUiAccent(accent: UiAccent): void {
  const normalized = parseUiAccent(accent);
  cacheUiAccent(normalized);
  persistUiPreferences({ uiAccent: normalized });
}

export function applyUiAccent(accent: UiAccent): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.accent = accent;
}
