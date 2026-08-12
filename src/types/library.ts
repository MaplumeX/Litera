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
  bytes: number[];
  bookId: string;
  importId: string;
}

/** Result of opening a book from the library. */
export interface OpenBookResult {
  bytes: number[];
  name: string;
  bookId: string;
  lastFraction?: number;
  settings?: ReadingSettings;
}
