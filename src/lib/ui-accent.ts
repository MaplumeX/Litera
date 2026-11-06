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

export function saveUiAccent(accent: UiAccent): void {
  try {
    localStorage.setItem(UI_ACCENT_KEY, accent);
  } catch {
    // Storage is unavailable: the accent still applies for this run.
  }
}

export function applyUiAccent(accent: UiAccent): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.accent = accent;
}
