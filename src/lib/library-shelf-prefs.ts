import type { LibrarySortKey } from "@/lib/library-shelf";

export const LIBRARY_SORT_KEY = "litera.librarySort";
export const LIBRARY_VIEW_KEY = "litera.libraryView";

export const DEFAULT_LIBRARY_SORT: LibrarySortKey = "recent";
export const DEFAULT_LIBRARY_VIEW = "grid" as const;

export type LibraryViewMode = "grid" | "list";

const SORT_KEYS: readonly LibrarySortKey[] = [
  "recent",
  "title",
  "author",
  "imported",
  "progress",
];

export function isLibrarySortKey(value: unknown): value is LibrarySortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

export function isLibraryViewMode(value: unknown): value is LibraryViewMode {
  return value === "grid" || value === "list";
}

export function parseLibrarySort(value: unknown): LibrarySortKey {
  return isLibrarySortKey(value) ? value : DEFAULT_LIBRARY_SORT;
}

export function parseLibraryView(value: unknown): LibraryViewMode {
  return isLibraryViewMode(value) ? value : DEFAULT_LIBRARY_VIEW;
}

export function loadLibrarySort(): LibrarySortKey {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_LIBRARY_SORT;
    return parseLibrarySort(localStorage.getItem(LIBRARY_SORT_KEY));
  } catch {
    return DEFAULT_LIBRARY_SORT;
  }
}

export function loadLibraryView(): LibraryViewMode {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_LIBRARY_VIEW;
    return parseLibraryView(localStorage.getItem(LIBRARY_VIEW_KEY));
  } catch {
    return DEFAULT_LIBRARY_VIEW;
  }
}

export function saveLibrarySort(sort: LibrarySortKey): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LIBRARY_SORT_KEY, parseLibrarySort(sort));
  } catch {
    // private mode / quota
  }
}

export function saveLibraryView(view: LibraryViewMode): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LIBRARY_VIEW_KEY, parseLibraryView(view));
  } catch {
    // private mode / quota
  }
}
