/** Reading settings persisted per book. */
export interface ReadingSettings {
  fontSize?: number;
  fontFamily?: string;
  theme?: string; // legacy "light" | "dark" | "sepia" — accepted for old files, not written
  lineHeight?: number | string; // number, or leftover "compact" | "normal" | "relaxed"
  pageMargin?: string; // leftover "narrow" | "normal" | "wide"
  contentWidth?: number;
  pagePadding?: number;
  textAlign?: string; // "start" | "justify"
  letterSpacing?: number;
  paragraphSpacing?: number;
  firstLineIndent?: number;
  columnCount?: number; // 1–3
  overrideFont?: boolean;
  overrideLayout?: boolean;
}

/** Per-book reader chrome open/closed snapshot. */
export interface ReaderLayout {
  chatCollapsed: boolean;
  bookCollapsed: boolean;
  sessionRailOpen: boolean;
}

/**
 * Reader-assigned reading status. Absent on a Book means it has not been
 * curated; `unread` is an explicit choice, not a default. Never derived from
 * reading progress.
 */
export type ReadingStatus = "unread" | "reading" | "finished";

/** A book record stored in library.json. */
export interface BookRecord {
  id: string;
  title: string;
  author: string;
  description?: string;
  publisher?: string;
  language?: string;
  series?: string;
  coverPath: string;
  filePath: string;
  importedAt: string;
  lastFraction?: number;
  lastCfi?: string;
  settings?: ReadingSettings;
  lastOpenedAt?: string;
  /**
   * Last edit to the record itself (metadata, curation, Restore). Never bumped
   * by reading-position or annotation writes; drives the sync merge's metadata
   * ordering and Tombstone revival.
   */
  updatedAt?: string;
  /** Reader-assigned curation; absent means not curated. */
  readingStatus?: ReadingStatus;
  starred?: boolean;
  contentHash?: string;
  lastReaderMode?: "reader" | "agent";
  lastLayout?: ReaderLayout;
  /** Derived: false when the EPUB is not on this device (sync placeholder). */
  cached?: boolean;
}

export type ImportStatus = "new" | "overwrite" | "duplicate";

/** Result of classifying / staging an import for frontend metadata extraction. */
export interface ImportBookResult {
  status: ImportStatus;
  bookId: string;
  title: string;
  importId?: string;
  name: string;
}

/** Lightweight context loaded separately from the raw EPUB body. */
export interface BookOpenContext {
  name: string;
  title: string;
  bookId: string;
  contentVersion: string;
  lastFraction?: number;
  lastCfi?: string;
  settings?: ReadingSettings;
  lastReaderMode?: "reader" | "agent";
  lastLayout?: ReaderLayout;
}

/**
 * One entry in the local Trash, as returned by `list_trashed_books`. The
 * Trash is local-only and never synced.
 */
export interface TrashEntry {
  /** Opaque id used to address the entry in restore/purge commands. */
  entryId: string;
  /** The Book's id; absent for orphan staging, which has no record. */
  bookId?: string;
  /** Empty when nothing identifies the entry (an orphan staged at startup). */
  title: string;
  author: string;
  /** Staged cover path; absent when the entry has none. */
  coverPath?: string;
  deletedAt?: string;
  origin: "local" | "sync";
  sizeBytes: number;
  hasSessions: boolean;
  /**
   * False when there is no record snapshot to put back, or when a remote
   * Tombstone would delete the book again — the entry can only be purged.
   */
  restorable: boolean;
}

/** A page bookmark stored in books/<id>/annotations.json — not on BookRecord. */
export interface BookmarkRecord {
  id: string;
  cfi: string;
  fraction: number;
  createdAt: string;
  label?: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";

/** A highlight stored in books/<id>/annotations.json — not on BookRecord. */
export interface HighlightRecord {
  id: string;
  cfi: string;
  excerpt: string;
  createdAt: string;
  color?: HighlightColor;
  note?: string;
}

export interface AnnotationsFile {
  schemaVersion: number;
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
}
