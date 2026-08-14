import { describe, expect, it } from "vitest";
import {
  ANNOTATIONS_SCHEMA_VERSION,
  appendBookmark,
  appendHighlight,
  createBookmark,
  createHighlight,
  emptyAnnotations,
  MAX_EXCERPT_BYTES,
  removeBookmark,
  removeHighlight,
  truncateUtf8Bytes,
} from "./annotations";

const location = {
  cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)",
  fraction: 0.42,
  label: "Chapter 3",
};

const selection = {
  cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
  excerpt: "selected sentence",
};

describe("annotations snapshot helpers", () => {
  it("builds a save payload without color or notes", () => {
    const bookmark = createBookmark(location);
    const highlight = createHighlight(selection);
    const data = appendHighlight(appendBookmark(emptyAnnotations(), bookmark), highlight);

    expect(data.schemaVersion).toBe(ANNOTATIONS_SCHEMA_VERSION);
    expect(data.bookmarks).toHaveLength(1);
    expect(data.highlights).toHaveLength(1);
    expect(data.bookmarks[0]).toMatchObject({
      cfi: location.cfi,
      fraction: 0.42,
      label: "Chapter 3",
    });
    expect(data.highlights[0]).toMatchObject({
      cfi: selection.cfi,
      excerpt: "selected sentence",
    });
    expect(data).not.toHaveProperty("notes");
    expect(JSON.stringify(data)).not.toContain("color");
  });

  it("does not add a second bookmark for the same CFI", () => {
    const first = createBookmark(location);
    const once = appendBookmark(emptyAnnotations(), first);
    const twice = appendBookmark(once, createBookmark(location));
    expect(twice).toBe(once);
    expect(twice.bookmarks).toHaveLength(1);
  });

  it("does not add a second highlight for the same CFI", () => {
    const first = createHighlight(selection);
    const once = appendHighlight(emptyAnnotations(), first);
    const twice = appendHighlight(once, createHighlight(selection));
    expect(twice).toBe(once);
  });

  it("caps highlight excerpts to the backend byte limit", () => {
    const excerpt = "选".repeat(2000);
    expect(new TextEncoder().encode(excerpt).length).toBeGreaterThan(MAX_EXCERPT_BYTES);
    const highlight = createHighlight({ cfi: selection.cfi, excerpt });
    expect(new TextEncoder().encode(highlight.excerpt).length).toBeLessThanOrEqual(
      MAX_EXCERPT_BYTES,
    );
    expect(truncateUtf8Bytes("abc", 2)).toBe("ab");
    expect(truncateUtf8Bytes("选中", 3)).toBe("选");
  });

  it("removes bookmarks and highlights by id", () => {
    const bookmark = createBookmark(location);
    const highlight = createHighlight(selection);
    const data = appendHighlight(appendBookmark(emptyAnnotations(), bookmark), highlight);
    expect(removeBookmark(data, bookmark.id).bookmarks).toEqual([]);
    expect(removeHighlight(data, highlight.id).removed?.cfi).toBe(selection.cfi);
    expect(removeHighlight(data, highlight.id).next.highlights).toEqual([]);
  });
});
