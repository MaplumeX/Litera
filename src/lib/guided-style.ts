import { GUIDED_STYLE_MAX_CHARS } from "@/agent/runtime/guide";

export const GUIDED_STYLE_KEY = "litera.guided-style";

/** The reader's guided style, or null for the default. Local to this device. */
export function loadGuidedStyle(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(GUIDED_STYLE_KEY);
    return value?.trim() && value.length <= GUIDED_STYLE_MAX_CHARS ? value : null;
  } catch {
    return null;
  }
}

/** Persist a custom guided style; empty or null restores the default. */
export function saveGuidedStyle(style: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!style?.trim()) localStorage.removeItem(GUIDED_STYLE_KEY);
    else localStorage.setItem(GUIDED_STYLE_KEY, style.slice(0, GUIDED_STYLE_MAX_CHARS));
  } catch {
    // Storage full or unavailable: the default style stays in effect.
  }
}
