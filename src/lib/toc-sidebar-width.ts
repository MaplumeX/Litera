export const TOC_WIDTH_KEY = "toc-sidebar-width";
export const TOC_WIDTH_DEFAULT = 224;
export const TOC_WIDTH_MIN = 160;

/** Clamp a TOC drawer width to [TOC_WIDTH_MIN, max]. */
export function clampTocWidth(width: number, max: number): number {
  if (!Number.isFinite(width)) return TOC_WIDTH_DEFAULT;
  const upper = Math.max(max, TOC_WIDTH_MIN);
  return Math.min(Math.max(Math.round(width), TOC_WIDTH_MIN), upper);
}

/** Read the persisted TOC drawer width; falls back to the default. */
export function loadTocWidth(): number {
  try {
    if (typeof localStorage === "undefined") return TOC_WIDTH_DEFAULT;
    const raw = localStorage.getItem(TOC_WIDTH_KEY);
    if (raw == null) return TOC_WIDTH_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < TOC_WIDTH_MIN) return TOC_WIDTH_DEFAULT;
    return parsed;
  } catch {
    return TOC_WIDTH_DEFAULT;
  }
}

/** Persist the TOC drawer width. */
export function saveTocWidth(width: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TOC_WIDTH_KEY, String(width));
  } catch {
    // private mode / quota
  }
}
