/** Reading settings persisted per book. */
export interface ReadingSettings {
  fontSize?: number;
  fontFamily?: string;
  theme?: string; // "light" | "dark" | "sepia"
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
}

/** Result of staging an import for frontend metadata extraction. */
export interface ImportBookResult {
  bookId: string;
  importId: string;
  name: string;
}

/** Lightweight context loaded separately from the raw EPUB body. */
export interface BookOpenContext {
  name: string;
  bookId: string;
  contentVersion: string;
  lastFraction?: number;
  settings?: ReadingSettings;
}
