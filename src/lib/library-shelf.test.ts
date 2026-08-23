import { describe, expect, it } from "vitest";
import type { BookRecord } from "@/types/library";
import {
  filterBooks,
  sortBooks,
  takeRecent,
  withCoverRevision,
} from "./library-shelf";

const base: BookRecord = {
  id: "id",
  title: "Title",
  author: "Author",
  coverPath: "",
  filePath: "/tmp/book.epub",
  importedAt: "2026-01-01T00:00:00+00:00",
};

function book(overrides: Partial<BookRecord> & Pick<BookRecord, "id">): BookRecord {
  return { ...base, ...overrides };
}

describe("sortBooks", () => {
  it("puts empty authors after named authors", () => {
    const books = [
      book({ id: "z", title: "Zebra", author: "zebra" }),
      book({ id: "empty", title: "No Author", author: "" }),
      book({ id: "a", title: "Alpha", author: "Alpha" }),
      book({ id: "space", title: "Spaces", author: "   " }),
    ];
    expect(sortBooks(books, "author").map((item) => item.id)).toEqual([
      "a",
      "z",
      "empty",
      "space",
    ]);
  });

  it("sorts by title case-insensitively", () => {
    const books = [
      book({ id: "b", title: "banana" }),
      book({ id: "a", title: "Apple" }),
      book({ id: "c", title: "Cherry" }),
    ];
    expect(sortBooks(books, "title").map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("sorts by progress descending and puts missing progress last", () => {
    const books = [
      book({ id: "none" }),
      book({ id: "mid", lastFraction: 0.4 }),
      book({ id: "high", lastFraction: 0.9 }),
      book({ id: "zero", lastFraction: 0 }),
    ];
    expect(sortBooks(books, "progress").map((item) => item.id)).toEqual([
      "high",
      "mid",
      "zero",
      "none",
    ]);
  });

  it("sorts recent by lastOpenedAt descending and puts never-opened last", () => {
    const books = [
      book({
        id: "old",
        lastOpenedAt: "2026-01-01T00:00:00+00:00",
        importedAt: "2026-06-01T00:00:00+00:00",
      }),
      book({
        id: "never",
        importedAt: "2026-08-01T00:00:00+00:00",
      }),
      book({
        id: "new",
        lastOpenedAt: "2026-03-01T00:00:00+00:00",
        importedAt: "2026-01-01T00:00:00+00:00",
      }),
    ];
    expect(sortBooks(books, "recent").map((item) => item.id)).toEqual([
      "new",
      "old",
      "never",
    ]);
  });

  it("sorts imported by importedAt descending", () => {
    const books = [
      book({ id: "early", importedAt: "2026-01-01T00:00:00+00:00" }),
      book({ id: "late", importedAt: "2026-03-01T00:00:00+00:00" }),
    ];
    expect(sortBooks(books, "imported").map((item) => item.id)).toEqual([
      "late",
      "early",
    ]);
  });
});

describe("takeRecent", () => {
  it("returns at most 4 books that have lastOpenedAt, newest first", () => {
    const books = [
      book({ id: "a", lastOpenedAt: "2026-01-01T00:00:00+00:00" }),
      book({ id: "never" }),
      book({ id: "b", lastOpenedAt: "2026-05-01T00:00:00+00:00" }),
      book({ id: "c", lastOpenedAt: "2026-03-01T00:00:00+00:00" }),
      book({ id: "d", lastOpenedAt: "2026-04-01T00:00:00+00:00" }),
      book({ id: "e", lastOpenedAt: "2026-02-01T00:00:00+00:00" }),
    ];
    expect(takeRecent(books).map((item) => item.id)).toEqual(["b", "d", "c", "e"]);
  });

  it("returns empty when no book has been opened", () => {
    expect(takeRecent([book({ id: "a" }), book({ id: "b" })])).toEqual([]);
  });
});

describe("withCoverRevision", () => {
  it("appends ?v= or &v= only when a revision is present", () => {
    expect(withCoverRevision("asset://cover.jpg")).toBe("asset://cover.jpg");
    expect(withCoverRevision("asset://cover.jpg", 0)).toBe("asset://cover.jpg");
    expect(withCoverRevision("asset://cover.jpg", 9)).toBe("asset://cover.jpg?v=9");
    expect(withCoverRevision("http://asset.localhost/cover.jpg?foo=1", 9)).toBe(
      "http://asset.localhost/cover.jpg?foo=1&v=9",
    );
  });
});

describe("filterBooks", () => {
  it("matches title or author case-insensitively and ignores empty query", () => {
    const books = [
      book({ id: "1", title: "The Hobbit", author: "Tolkien" }),
      book({ id: "2", title: "Dune", author: "Herbert" }),
    ];
    expect(filterBooks(books, "  ").map((item) => item.id)).toEqual(["1", "2"]);
    expect(filterBooks(books, "hob").map((item) => item.id)).toEqual(["1"]);
    expect(filterBooks(books, "HERB").map((item) => item.id)).toEqual(["2"]);
  });
});
