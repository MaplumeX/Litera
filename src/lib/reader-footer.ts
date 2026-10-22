import { useSyncExternalStore } from "react";

export const READER_FOOTER_ITEMS = [
  "none", "chapter", "book-progress", "chapter-progress", "time", "battery",
] as const;
export type ReaderFooterItem = (typeof READER_FOOTER_ITEMS)[number];
export const READER_FOOTER_POSITIONS = ["left", "center", "right"] as const;
export type ReaderFooterPosition = (typeof READER_FOOTER_POSITIONS)[number];

export interface ReaderFooterSettings {
  enabled: boolean;
  left: ReaderFooterItem;
  center: ReaderFooterItem;
  right: ReaderFooterItem;
}

// Device preference only. Keep this out of book settings, app preferences and Sync.
export const READER_FOOTER_KEY = "litera.readerFooter";
export const DEFAULT_READER_FOOTER: ReaderFooterSettings = {
  enabled: true,
  left: "chapter",
  center: "chapter-progress",
  right: "book-progress",
};

export function parseReaderFooter(raw: string | null): ReaderFooterSettings {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_READER_FOOTER;
    const record = value as Record<string, unknown>;
    const item = (position: ReaderFooterPosition): ReaderFooterItem =>
      READER_FOOTER_ITEMS.includes(record[position] as ReaderFooterItem)
        ? record[position] as ReaderFooterItem
        : DEFAULT_READER_FOOTER[position];
    return {
      enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_READER_FOOTER.enabled,
      left: item("left"),
      center: item("center"),
      right: item("right"),
    };
  } catch {
    return DEFAULT_READER_FOOTER;
  }
}

let cached: { raw: string | null; value: ReaderFooterSettings } | undefined;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(READER_FOOTER_KEY);
  } catch {
    return null;
  }
}

export function loadReaderFooter(): ReaderFooterSettings {
  const raw = readRaw();
  if (!cached || cached.raw !== raw) cached = { raw, value: parseReaderFooter(raw) };
  return cached.value;
}

export function saveReaderFooter(patch: Partial<ReaderFooterSettings>): void {
  const next = { ...loadReaderFooter(), ...patch };
  try {
    localStorage.setItem(READER_FOOTER_KEY, JSON.stringify(next));
  } catch {
    // Keep the preference for this session if storage is unavailable.
  }
  cached = { raw: readRaw(), value: next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === READER_FOOTER_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReaderFooter(): [ReaderFooterSettings, typeof saveReaderFooter] {
  return [useSyncExternalStore(subscribe, loadReaderFooter, loadReaderFooter), saveReaderFooter];
}
