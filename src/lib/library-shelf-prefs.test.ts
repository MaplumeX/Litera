// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_SORT,
  DEFAULT_LIBRARY_STATUS_FILTER,
  DEFAULT_LIBRARY_VIEW,
  LIBRARY_SORT_KEY,
  LIBRARY_SORT_ORDER_KEY,
  LIBRARY_STATUS_FILTER_KEY,
  LIBRARY_VIEW_KEY,
  loadLibrarySort,
  loadLibrarySortOrder,
  loadLibraryStatusFilter,
  loadLibraryView,
  parseLibrarySort,
  parseLibrarySortOrder,
  parseLibraryStatusFilter,
  parseLibraryView,
  saveLibrarySort,
  saveLibrarySortOrder,
  saveLibraryStatusFilter,
  saveLibraryView,
} from "./library-shelf-prefs";

afterEach(() => {
  localStorage.removeItem(LIBRARY_SORT_KEY);
  localStorage.removeItem(LIBRARY_SORT_ORDER_KEY);
  localStorage.removeItem(LIBRARY_STATUS_FILTER_KEY);
  localStorage.removeItem(LIBRARY_VIEW_KEY);
});

describe("parseLibrarySort / parseLibraryView", () => {
  it("falls back for missing or invalid values", () => {
    expect(parseLibrarySort(undefined)).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseLibrarySort(null)).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseLibrarySort("")).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseLibrarySort("newest")).toBe(DEFAULT_LIBRARY_SORT);
    expect(parseLibrarySort("title")).toBe("title");
    expect(parseLibraryView(undefined)).toBe(DEFAULT_LIBRARY_VIEW);
    expect(parseLibraryView("cards")).toBe(DEFAULT_LIBRARY_VIEW);
    expect(parseLibraryView("list")).toBe("list");
  });
});

describe("load / save library shelf prefs", () => {
  it("returns defaults when nothing is saved", () => {
    expect(loadLibrarySort()).toBe(DEFAULT_LIBRARY_SORT);
    expect(loadLibraryView()).toBe(DEFAULT_LIBRARY_VIEW);
  });

  it("round-trips valid values", () => {
    saveLibrarySort("progress");
    saveLibraryView("list");
    expect(localStorage.getItem(LIBRARY_SORT_KEY)).toBe("progress");
    expect(localStorage.getItem(LIBRARY_VIEW_KEY)).toBe("list");
    expect(loadLibrarySort()).toBe("progress");
    expect(loadLibraryView()).toBe("list");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(LIBRARY_SORT_KEY, "alphabetical");
    localStorage.setItem(LIBRARY_VIEW_KEY, "masonry");
    expect(loadLibrarySort()).toBe(DEFAULT_LIBRARY_SORT);
    expect(loadLibraryView()).toBe(DEFAULT_LIBRARY_VIEW);
  });
});

describe("library sort order prefs", () => {
  it("falls back to the sort key's natural direction", () => {
    expect(parseLibrarySortOrder(undefined, "title")).toBe("asc");
    expect(parseLibrarySortOrder(null, "recent")).toBe("desc");
    expect(parseLibrarySortOrder("sideways", "progress")).toBe("desc");
    expect(parseLibrarySortOrder("asc", "recent")).toBe("asc");
    expect(parseLibrarySortOrder("desc", "title")).toBe("desc");
  });

  it("round-trips a saved direction", () => {
    saveLibrarySortOrder("asc");
    expect(localStorage.getItem(LIBRARY_SORT_ORDER_KEY)).toBe("asc");
    expect(loadLibrarySortOrder("recent")).toBe("asc");
  });

  it("ignores an invalid stored direction", () => {
    localStorage.setItem(LIBRARY_SORT_ORDER_KEY, "masonry");
    expect(loadLibrarySortOrder("title")).toBe("asc");
    expect(loadLibrarySortOrder("imported")).toBe("desc");
  });
});

describe("library status filter prefs", () => {
  it("falls back to all for missing or unknown values", () => {
    expect(parseLibraryStatusFilter(undefined)).toBe(DEFAULT_LIBRARY_STATUS_FILTER);
    expect(parseLibraryStatusFilter("favourite")).toBe(DEFAULT_LIBRARY_STATUS_FILTER);
    expect(parseLibraryStatusFilter("starred")).toBe("starred");
  });

  it("round-trips a saved filter", () => {
    saveLibraryStatusFilter("reading");
    expect(localStorage.getItem(LIBRARY_STATUS_FILTER_KEY)).toBe("reading");
    expect(loadLibraryStatusFilter()).toBe("reading");
  });

  it("ignores an invalid stored filter", () => {
    localStorage.setItem(LIBRARY_STATUS_FILTER_KEY, "masonry");
    expect(loadLibraryStatusFilter()).toBe(DEFAULT_LIBRARY_STATUS_FILTER);
  });
});
