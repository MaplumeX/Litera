export const CHAT_PANEL_WIDTH_KEY = "litera.chat-panel-width";
export const CHAT_PANEL_WIDTH_DEFAULT = 22;
export const CHAT_PANEL_WIDTH_MIN = 18;
export const CHAT_PANEL_WIDTH_MAX = 50;

const LEGACY_LAYOUT_KEY = "react-resizable-panels:reader-chat";

/** Clamp a reader-mode chat pane width (percent) to [min, max]. */
export function clampChatPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return CHAT_PANEL_WIDTH_DEFAULT;
  return Math.min(Math.max(Math.round(width), CHAT_PANEL_WIDTH_MIN), CHAT_PANEL_WIDTH_MAX);
}

function readLegacyChatWidth(): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LEGACY_LAYOUT_KEY);
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const direct = record.chat;
    if (typeof direct === "number") return clampChatPanelWidth(direct);
    for (const value of Object.values(record)) {
      if (!value || typeof value !== "object") continue;
      const layout = (value as { layout?: unknown }).layout;
      if (!Array.isArray(layout)) continue;
      const keys = Object.keys(record)[0]?.split(",") ?? [];
      const chatIndex = keys.indexOf("chat");
      const chatValue = chatIndex >= 0 ? layout[chatIndex] : layout[layout.length - 1];
      if (typeof chatValue === "number") return clampChatPanelWidth(chatValue);
    }
    return null;
  } catch {
    return null;
  }
}

/** Read the persisted reader chat pane width; falls back to the default. */
export function loadChatPanelWidth(): number {
  try {
    if (typeof localStorage === "undefined") return CHAT_PANEL_WIDTH_DEFAULT;
    const raw = localStorage.getItem(CHAT_PANEL_WIDTH_KEY);
    if (raw != null) {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed >= CHAT_PANEL_WIDTH_MIN) {
        return clampChatPanelWidth(parsed);
      }
    }
    return readLegacyChatWidth() ?? CHAT_PANEL_WIDTH_DEFAULT;
  } catch {
    return CHAT_PANEL_WIDTH_DEFAULT;
  }
}

/** Persist the reader chat pane width. */
export function saveChatPanelWidth(width: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(clampChatPanelWidth(width)));
  } catch {
    // private mode / quota
  }
}
