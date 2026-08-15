export type ReaderMode = "reader" | "agent";

export const DEFAULT_READER_MODE_KEY = "litera.defaultReaderMode";
export const DEFAULT_READER_MODE: ReaderMode = "reader";

export function isReaderMode(value: unknown): value is ReaderMode {
  return value === "reader" || value === "agent";
}

export function parseReaderMode(value: unknown): ReaderMode {
  return isReaderMode(value) ? value : DEFAULT_READER_MODE;
}

/** Resolve the mode for an opened book: per-book memory, then app default, then reader. */
export function resolveReaderMode(bookMode: unknown): ReaderMode {
  if (isReaderMode(bookMode)) return bookMode;
  return loadDefaultReaderMode();
}

export function loadDefaultReaderMode(): ReaderMode {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_READER_MODE;
    return parseReaderMode(localStorage.getItem(DEFAULT_READER_MODE_KEY));
  } catch {
    return DEFAULT_READER_MODE;
  }
}

export function saveDefaultReaderMode(mode: ReaderMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DEFAULT_READER_MODE_KEY, mode);
  } catch {
    // private mode / quota
  }
}
