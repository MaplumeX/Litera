import {
  UI_ACCENT_KEY,
  applyUiAccent,
  cacheUiAccent,
  loadUiAccent,
  parseUiAccent,
} from "@/lib/ui-accent";
import {
  CHAT_FONT_FAMILY_KEY,
  UI_FONT_FAMILY_KEY,
  UI_FONT_SIZE_KEY,
  applyChatFont,
  applyUiChrome,
  cacheChatFontFamily,
  cacheUiFontFamily,
  cacheUiFontSize,
  loadChatFontFamily,
  loadUiFontFamily,
  loadUiFontSize,
  parseChatFontFamily,
  parseUiFontFamily,
  parseUiFontSize,
} from "@/lib/ui-chrome-font";
import {
  flushUiPreferences,
  isUiPreferenceDirty,
  notifyUiPreferences,
  persistUiPreferences,
  readUiPreferencesFromDisk,
  subscribeUiPreferences,
  type UiPreferencesSnapshot,
} from "@/lib/ui-preferences-store";

export { flushUiPreferences, subscribeUiPreferences };

function readRawStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Reconcile the synchronous `localStorage` boot cache with durable disk
 * storage (`ui-preferences.json`).
 *
 * - Fields stored on disk win over stale or dropped `localStorage` values
 *   (unless the user already edited that field during this session).
 * - Fields present only in `localStorage` (upgrading from a build before disk
 *   backing existed) are migrated once to disk.
 */
export async function hydrateUiPreferences(): Promise<void> {
  const disk = await readUiPreferencesFromDisk();
  const migration: UiPreferencesSnapshot = {};
  let chromeChanged = false;
  let chatChanged = false;
  let accentChanged = false;

  if (disk?.uiFontSize !== undefined) {
    if (!isUiPreferenceDirty("uiFontSize")) {
      const next = parseUiFontSize(disk.uiFontSize);
      const prev = loadUiFontSize();
      cacheUiFontSize(next);
      if (next !== prev) chromeChanged = true;
    }
  } else if (!isUiPreferenceDirty("uiFontSize")) {
    const raw = readRawStorage(UI_FONT_SIZE_KEY);
    if (raw !== null) migration.uiFontSize = parseUiFontSize(raw);
  }

  if (disk?.uiFontFamily !== undefined) {
    if (!isUiPreferenceDirty("uiFontFamily")) {
      const next = parseUiFontFamily(disk.uiFontFamily);
      const prev = loadUiFontFamily();
      cacheUiFontFamily(next);
      if (next !== prev) chromeChanged = true;
    }
  } else if (!isUiPreferenceDirty("uiFontFamily")) {
    const raw = readRawStorage(UI_FONT_FAMILY_KEY);
    if (raw !== null) migration.uiFontFamily = parseUiFontFamily(raw);
  }

  if (disk?.chatFontFamily !== undefined) {
    if (!isUiPreferenceDirty("chatFontFamily")) {
      const next = parseChatFontFamily(disk.chatFontFamily);
      const prev = loadChatFontFamily();
      cacheChatFontFamily(next);
      if (next !== prev) chatChanged = true;
    }
  } else if (!isUiPreferenceDirty("chatFontFamily")) {
    const raw = readRawStorage(CHAT_FONT_FAMILY_KEY);
    if (raw !== null) migration.chatFontFamily = parseChatFontFamily(raw);
  }

  if (disk?.uiAccent !== undefined) {
    if (!isUiPreferenceDirty("uiAccent")) {
      const next = parseUiAccent(disk.uiAccent);
      const prev = loadUiAccent();
      cacheUiAccent(next);
      if (next !== prev) accentChanged = true;
    }
  } else if (!isUiPreferenceDirty("uiAccent")) {
    const raw = readRawStorage(UI_ACCENT_KEY);
    if (raw !== null) migration.uiAccent = parseUiAccent(raw);
  }

  if (chromeChanged) {
    applyUiChrome(loadUiFontSize(), loadUiFontFamily());
  }
  if (chatChanged) {
    applyChatFont(loadChatFontFamily());
  }
  if (accentChanged) {
    applyUiAccent(loadUiAccent());
  }
  if (chromeChanged || chatChanged || accentChanged) {
    notifyUiPreferences();
  }

  if (Object.keys(migration).length > 0) {
    persistUiPreferences(migration, { markDirty: false });
  }
}
