import type { ReaderLayout } from "@/types/library";

export type { ReaderLayout };

export const DEFAULT_READER_LAYOUT: ReaderLayout = {
  chatCollapsed: true,
  bookCollapsed: false,
  sessionRailOpen: true,
};

export function isReaderLayout(value: unknown): value is ReaderLayout {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.chatCollapsed === "boolean" &&
    typeof record.bookCollapsed === "boolean" &&
    typeof record.sessionRailOpen === "boolean"
  );
}

/** Resolve the layout for an opened book: saved snapshot, else first-open defaults. */
export function resolveReaderLayout(value: unknown): ReaderLayout {
  if (!isReaderLayout(value)) return { ...DEFAULT_READER_LAYOUT };
  return {
    chatCollapsed: value.chatCollapsed,
    bookCollapsed: value.bookCollapsed,
    sessionRailOpen: value.sessionRailOpen,
  };
}
