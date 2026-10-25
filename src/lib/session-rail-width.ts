export const SESSION_RAIL_WIDTH_KEY = "session-rail-width";
export const SESSION_RAIL_WIDTH_DEFAULT = 240;
export const SESSION_RAIL_WIDTH_MIN = 180;
export const SESSION_RAIL_WIDTH_MAX = 480;

/** Clamp a session rail width to [MIN, min(MAX, max)]. */
export function clampSessionRailWidth(width: number, max = SESSION_RAIL_WIDTH_MAX): number {
  if (!Number.isFinite(width)) return SESSION_RAIL_WIDTH_DEFAULT;
  const upper = Math.max(Math.min(max, SESSION_RAIL_WIDTH_MAX), SESSION_RAIL_WIDTH_MIN);
  return Math.min(Math.max(Math.round(width), SESSION_RAIL_WIDTH_MIN), upper);
}

/** Read the persisted session rail width; falls back to the default. */
export function loadSessionRailWidth(): number {
  try {
    if (typeof localStorage === "undefined") return SESSION_RAIL_WIDTH_DEFAULT;
    const raw = localStorage.getItem(SESSION_RAIL_WIDTH_KEY);
    if (raw == null) return SESSION_RAIL_WIDTH_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < SESSION_RAIL_WIDTH_MIN) {
      return SESSION_RAIL_WIDTH_DEFAULT;
    }
    return clampSessionRailWidth(parsed);
  } catch {
    return SESSION_RAIL_WIDTH_DEFAULT;
  }
}

/** Persist the session rail width. */
export function saveSessionRailWidth(width: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SESSION_RAIL_WIDTH_KEY, String(width));
  } catch {
    // private mode / quota
  }
}
