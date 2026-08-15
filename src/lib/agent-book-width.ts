export const AGENT_BOOK_WIDTH_KEY = "litera.agent-book-width";
export const AGENT_BOOK_WIDTH_DEFAULT = 38;
export const AGENT_BOOK_WIDTH_MIN = 22;
export const AGENT_BOOK_WIDTH_MAX = 60;

/** Clamp an Agent-mode book pane width (percent) to [min, max]. */
export function clampAgentBookWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_BOOK_WIDTH_DEFAULT;
  return Math.min(Math.max(Math.round(width), AGENT_BOOK_WIDTH_MIN), AGENT_BOOK_WIDTH_MAX);
}

/** Read the persisted Agent book pane width; falls back to the default. */
export function loadAgentBookWidth(): number {
  try {
    if (typeof localStorage === "undefined") return AGENT_BOOK_WIDTH_DEFAULT;
    const raw = localStorage.getItem(AGENT_BOOK_WIDTH_KEY);
    if (raw == null) return AGENT_BOOK_WIDTH_DEFAULT;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < AGENT_BOOK_WIDTH_MIN) {
      return AGENT_BOOK_WIDTH_DEFAULT;
    }
    return clampAgentBookWidth(parsed);
  } catch {
    return AGENT_BOOK_WIDTH_DEFAULT;
  }
}

/** Persist the Agent book pane width. */
export function saveAgentBookWidth(width: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(AGENT_BOOK_WIDTH_KEY, String(clampAgentBookWidth(width)));
  } catch {
    // private mode / quota
  }
}
