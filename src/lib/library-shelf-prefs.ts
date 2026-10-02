import {
  isLibrarySortOrder,
  isLibraryStatusFilter,
  naturalOrderFor,
  type LibrarySortKey,
  type LibrarySortOrder,
  type LibraryStatusFilter,
} from "@/lib/library-shelf";

export const LIBRARY_SORT_KEY = "litera.librarySort";
export const LIBRARY_SORT_ORDER_KEY = "litera.librarySortOrder";
export const LIBRARY_STATUS_FILTER_KEY = "litera.libraryStatusFilter";
export const LIBRARY_VIEW_KEY = "litera.libraryView";

export const DEFAULT_LIBRARY_SORT: LibrarySortKey = "recent";
export const DEFAULT_LIBRARY_VIEW = "grid" as const;
export const DEFAULT_LIBRARY_STATUS_FILTER: LibraryStatusFilter = "all";

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

/**
 * The stored direction, or the sort key's natural direction when nothing valid
 * is saved. Direction depends on the key, so the key is required input.
 */
export function parseLibrarySortOrder(
  value: unknown,
  sort: LibrarySortKey,
): LibrarySortOrder {
  return isLibrarySortOrder(value) ? value : naturalOrderFor(sort);
}

export function loadLibrarySortOrder(sort: LibrarySortKey): LibrarySortOrder {
  try {
    if (typeof localStorage === "undefined") return naturalOrderFor(sort);
    return parseLibrarySortOrder(
      localStorage.getItem(LIBRARY_SORT_ORDER_KEY),
      sort,
    );
  } catch {
    return naturalOrderFor(sort);
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

export function saveLibrarySortOrder(order: LibrarySortOrder): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!isLibrarySortOrder(order)) return;
    localStorage.setItem(LIBRARY_SORT_ORDER_KEY, order);
  } catch {
    // private mode / quota
  }
}

export function parseLibraryStatusFilter(value: unknown): LibraryStatusFilter {
  return isLibraryStatusFilter(value) ? value : DEFAULT_LIBRARY_STATUS_FILTER;
}

export function loadLibraryStatusFilter(): LibraryStatusFilter {
  try {
    if (typeof localStorage === "undefined") {
      return DEFAULT_LIBRARY_STATUS_FILTER;
    }
    return parseLibraryStatusFilter(
      localStorage.getItem(LIBRARY_STATUS_FILTER_KEY),
    );
  } catch {
    return DEFAULT_LIBRARY_STATUS_FILTER;
  }
}

export function saveLibraryStatusFilter(filter: LibraryStatusFilter): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!isLibraryStatusFilter(filter)) return;
    localStorage.setItem(LIBRARY_STATUS_FILTER_KEY, filter);
  } catch {
    // private mode / quota
  }
}
