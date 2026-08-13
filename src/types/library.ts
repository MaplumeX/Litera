/** Reading settings persisted per book. */
export interface ReadingSettings {
  fontSize?: number;
  fontFamily?: string;
  theme?: string; // "light" | "dark" | "sepia"
  lineHeight?: string; // "compact" | "normal" | "relaxed"
  pageMargin?: string; // "narrow" | "normal" | "wide"
  textAlign?: string; // "start" | "justify"
}

/** A book record stored in library.json. */
export interface BookRecord {
  id: string;
  title: string;
  author: string;
  coverPath: string;
  filePath: string;
  importedAt: string;
  lastFraction?: number;
  settings?: ReadingSettings;
  lastOpenedAt?: string;
  contentHash?: string;
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
  settings?: ReadingSettings;
}
