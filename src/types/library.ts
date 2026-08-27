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
  contentHash?: string;
  lastReaderMode?: "reader" | "agent";
  lastLayout?: ReaderLayout;
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
