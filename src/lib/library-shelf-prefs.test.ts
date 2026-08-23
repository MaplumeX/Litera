// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_SORT,
  DEFAULT_LIBRARY_VIEW,
  LIBRARY_SORT_KEY,
  LIBRARY_VIEW_KEY,
  loadLibrarySort,
  loadLibraryView,
  parseLibrarySort,
  parseLibraryView,
  saveLibrarySort,
  saveLibraryView,
} from "./library-shelf-prefs";

afterEach(() => {
  localStorage.removeItem(LIBRARY_SORT_KEY);
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
