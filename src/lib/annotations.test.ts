import { afterEach, describe, expect, it } from "vitest";
import {
  ANNOTATIONS_SCHEMA_VERSION,
  appendBookmark,
  appendHighlight,
  createBookmark,
  createHighlight,
  DEFAULT_HIGHLIGHT_COLOR,
  emptyAnnotations,
  getLastUsedHighlightColor,
  highlightColorHex,
  isHighlightOverlayKey,
  MAX_EXCERPT_BYTES,
  MAX_NOTE_BYTES,
  removeBookmark,
  removeHighlight,
  resetLastUsedHighlightColor,
  resolveHighlightColor,
  setLastUsedHighlightColor,
  truncateUtf8Bytes,
  updateHighlight,
} from "./annotations";
import type { HighlightRecord } from "@/types/library";

const location = {
  cfi: "epubcfi(/6/8!/4/2,/1:0,/1:80)",
  fraction: 0.42,
  label: "Chapter 3",
};

const selection = {
  cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
  excerpt: "selected sentence",
};

afterEach(() => {
  resetLastUsedHighlightColor();
});

describe("annotations snapshot helpers", () => {
  it("stamps the default color on new highlights and omits notes", () => {
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
      color: DEFAULT_HIGHLIGHT_COLOR,
    });
    expect(data.highlights[0]).not.toHaveProperty("note");
    expect(data).not.toHaveProperty("notes");
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

  it("uses the process last-used color for new highlights", () => {
    expect(getLastUsedHighlightColor()).toBe("yellow");
    setLastUsedHighlightColor("blue");
    expect(createHighlight(selection).color).toBe("blue");
    resetLastUsedHighlightColor();
    expect(createHighlight(selection).color).toBe("yellow");
  });

  it("treats missing color as yellow without requiring the field", () => {
    const old: HighlightRecord = {
      id: "h-old",
      cfi: selection.cfi,
      excerpt: selection.excerpt,
      createdAt: "2026-08-14T12:01:00+00:00",
    };
    expect(old).not.toHaveProperty("color");
    expect(old).not.toHaveProperty("note");
    expect(resolveHighlightColor(old.color)).toBe("yellow");
    expect(highlightColorHex(old.color)).toBe("#fbbf24");
  });

  it("updates color and note, stamps color on old records, and omits blank notes", () => {
    const old: HighlightRecord = {
      id: "h-old",
      cfi: selection.cfi,
      excerpt: selection.excerpt,
      createdAt: "2026-08-14T12:01:00+00:00",
    };
    const once = appendHighlight(emptyAnnotations(), old);
    const colored = updateHighlight(once, old.id, { color: "green" });
    expect(colored.highlights[0]).toMatchObject({ color: "green" });
    expect(getLastUsedHighlightColor()).toBe("green");

    const noted = updateHighlight(colored, old.id, { note: "  why I marked  " });
    expect(noted.highlights[0]).toMatchObject({ color: "green", note: "why I marked" });

    const cleared = updateHighlight(noted, old.id, { note: "   " });
    expect(cleared.highlights[0]).toMatchObject({ color: "green" });
    expect(cleared.highlights[0]).not.toHaveProperty("note");

    const stamped = updateHighlight(once, old.id, { note: "keep" });
    expect(stamped.highlights[0]).toMatchObject({ color: "yellow", note: "keep" });
  });

  it("caps notes to the backend byte limit", () => {
    const highlight = createHighlight(selection);
    const data = appendHighlight(emptyAnnotations(), highlight);
    const note = "选".repeat(2000);
    expect(new TextEncoder().encode(note).length).toBeGreaterThan(MAX_NOTE_BYTES);
    const updated = updateHighlight(data, highlight.id, { note });
    expect(new TextEncoder().encode(updated.highlights[0].note ?? "").length).toBeLessThanOrEqual(
      MAX_NOTE_BYTES,
    );
  });

  it("returns the same snapshot when the highlight id is unknown", () => {
    const data = emptyAnnotations();
    expect(updateHighlight(data, "missing", { color: "pink" })).toBe(data);
  });

  it("only treats CFI overlay keys as user highlights", () => {
    expect(isHighlightOverlayKey("epubcfi(/6/8!/4/2)")).toBe(true);
    expect(isHighlightOverlayKey("litera-tts")).toBe(false);
    expect(isHighlightOverlayKey("foliate-search:epubcfi(/6/8)")).toBe(false);
    expect(isHighlightOverlayKey(undefined)).toBe(false);
  });
});
