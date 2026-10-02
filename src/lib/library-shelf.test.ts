import { describe, expect, it } from "vitest";
import type { BookRecord } from "@/types/library";
import {
  filterBooks,
  filterByStatus,
  isLibraryStatusFilter,
  naturalOrderFor,
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

  it("exposes a natural direction per sort key", () => {
    expect(naturalOrderFor("title")).toBe("asc");
    expect(naturalOrderFor("author")).toBe("asc");
    expect(naturalOrderFor("recent")).toBe("desc");
    expect(naturalOrderFor("imported")).toBe("desc");
    expect(naturalOrderFor("progress")).toBe("desc");
  });

  it("applies the requested direction to every sort key", () => {
    const books = [
      book({
        id: "a",
        title: "Alpha",
        author: "Alpha",
        importedAt: "2026-01-01T00:00:00+00:00",
        lastFraction: 0.1,
        lastOpenedAt: "2026-01-01T00:00:00+00:00",
      }),
      book({
        id: "b",
        title: "Beta",
        author: "Beta",
        importedAt: "2026-02-01T00:00:00+00:00",
        lastFraction: 0.2,
        lastOpenedAt: "2026-02-01T00:00:00+00:00",
      }),
    ];
    const ids = (key: Parameters<typeof sortBooks>[1], order: "asc" | "desc") =>
      sortBooks(books, key, order).map((item) => item.id);
    expect(ids("title", "asc")).toEqual(["a", "b"]);
    expect(ids("title", "desc")).toEqual(["b", "a"]);
    expect(ids("author", "asc")).toEqual(["a", "b"]);
    expect(ids("author", "desc")).toEqual(["b", "a"]);
    expect(ids("imported", "asc")).toEqual(["a", "b"]);
    expect(ids("imported", "desc")).toEqual(["b", "a"]);
    expect(ids("progress", "asc")).toEqual(["a", "b"]);
    expect(ids("progress", "desc")).toEqual(["b", "a"]);
    expect(ids("recent", "asc")).toEqual(["a", "b"]);
    expect(ids("recent", "desc")).toEqual(["b", "a"]);
  });

  it("defaults to the natural direction when none is given", () => {
    const books = [
      book({ id: "alpha", title: "Alpha", importedAt: "2026-01-01T00:00:00+00:00" }),
      book({ id: "zeta", title: "Zeta", importedAt: "2026-02-01T00:00:00+00:00" }),
    ];
    expect(sortBooks(books, "title").map((item) => item.id)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(sortBooks(books, "imported").map((item) => item.id)).toEqual([
      "zeta",
      "alpha",
    ]);
  });

  it("keeps positional rules when the direction is reversed", () => {
    const authors = [
      book({ id: "none", author: "" }),
      book({ id: "mid", author: "Mid" }),
      book({ id: "zed", author: "Zed" }),
    ];
    expect(sortBooks(authors, "author", "desc").map((item) => item.id)).toEqual([
      "zed",
      "mid",
      "none",
    ]);

    const progress = [
      book({ id: "none" }),
      book({ id: "low", lastFraction: 0.1 }),
      book({ id: "high", lastFraction: 0.9 }),
    ];
    expect(sortBooks(progress, "progress", "asc").map((item) => item.id)).toEqual([
      "low",
      "high",
      "none",
    ]);

    const opened = [
      book({ id: "never" }),
      book({ id: "old", lastOpenedAt: "2026-01-01T00:00:00+00:00" }),
      book({ id: "new", lastOpenedAt: "2026-05-01T00:00:00+00:00" }),
    ];
    expect(sortBooks(opened, "recent", "asc").map((item) => item.id)).toEqual([
      "old",
      "new",
      "never",
    ]);
  });

  it("breaks ties the same way in both directions", () => {
    // Neither book was ever opened → the fallback orders by importedAt, newest
    // first, and does not flip with the direction.
    const neverOpened = [
      book({ id: "older-import", importedAt: "2026-02-01T00:00:00+00:00" }),
      book({ id: "newer-import", importedAt: "2026-03-01T00:00:00+00:00" }),
    ];
    expect(sortBooks(neverOpened, "recent", "asc").map((item) => item.id)).toEqual([
      "newer-import",
      "older-import",
    ]);
    expect(sortBooks(neverOpened, "recent", "desc").map((item) => item.id)).toEqual([
      "newer-import",
      "older-import",
    ]);

    // Books with no progress fall back to recency the same way.
    const noProgress = [
      book({ id: "older", lastOpenedAt: "2026-01-01T00:00:00+00:00" }),
      book({ id: "newer", lastOpenedAt: "2026-05-01T00:00:00+00:00" }),
    ];
    expect(sortBooks(noProgress, "progress", "asc").map((item) => item.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(sortBooks(noProgress, "progress", "desc").map((item) => item.id)).toEqual([
      "newer",
      "older",
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

  it.each<[string, keyof BookRecord, string]>([
    ["title", "title", "Solaris"],
    ["author", "author", "Lem"],
    ["series", "series", "Penguin Classics"],
    ["publisher", "publisher", "Faber"],
    ["language", "language", "pl"],
    ["description", "description", "a living ocean"],
  ])("matches the %s field", (_label, field, value) => {
    const books = [
      book({ id: "hit", [field]: value }),
      book({ id: "miss", title: "Other", author: "Someone" }),
    ];
    const token = value.split(" ")[value.split(" ").length - 1].toLowerCase();
    expect(filterBooks(books, token).map((item) => item.id)).toEqual(["hit"]);
  });

  it("satisfies a multi-token query from different fields", () => {
    const books = [
      book({ id: "hit", title: "The Hobbit", series: "Penguin Classics" }),
      book({ id: "miss", title: "The Hobbit", series: "Harper" }),
      book({ id: "miss2", title: "Dune", series: "Penguin Classics" }),
    ];
    expect(filterBooks(books, "penguin hobbit").map((item) => item.id)).toEqual([
      "hit",
    ]);
  });

  it("matches a whole multi-word field value across whitespace", () => {
    const books = [book({ id: "hit", series: "Penguin Classics" })];
    expect(filterBooks(books, "penguin classics").map((item) => item.id)).toEqual([
      "hit",
    ]);
  });

  it("returns nothing when a token matches no field", () => {
    const books = [book({ id: "1", title: "Dune", author: "Herbert" })];
    expect(filterBooks(books, "dune missing")).toEqual([]);
  });

  it("handles records without optional fields", () => {
    const books = [book({ id: "1", title: "Dune" })];
    expect(filterBooks(books, "dune").map((item) => item.id)).toEqual(["1"]);
    expect(filterBooks(books, "penguin")).toEqual([]);
  });

  it("does not let two adjacent fields spell a match together", () => {
    const books = [book({ id: "1", title: "Ho", author: "bbit" })];
    expect(filterBooks(books, "hobbit")).toEqual([]);
  });
});

describe("filterByStatus", () => {
  const books = [
    book({ id: "reading", readingStatus: "reading" }),
    book({ id: "finished", readingStatus: "finished" }),
    book({ id: "unread", readingStatus: "unread" }),
    book({ id: "uncategorized" }),
    book({ id: "starred-unread", readingStatus: "unread", starred: true }),
    book({ id: "starred-reading", readingStatus: "reading", starred: true }),
  ];

  it("passes every book through for all", () => {
    expect(filterByStatus(books, "all").map((item) => item.id)).toEqual([
      "reading",
      "finished",
      "unread",
      "uncategorized",
      "starred-unread",
      "starred-reading",
    ]);
  });

  it("never treats an absent status as unread", () => {
    expect(filterByStatus(books, "unread").map((item) => item.id)).toEqual([
      "unread",
      "starred-unread",
    ]);
  });

  it.each([
    ["reading" as const, ["reading", "starred-reading"]],
    ["finished" as const, ["finished"]],
  ])("narrows to %s", (filter, expected) => {
    expect(filterByStatus(books, filter).map((item) => item.id)).toEqual(expected);
  });

  it("selects the starred shortlist regardless of status", () => {
    expect(filterByStatus(books, "starred").map((item) => item.id)).toEqual([
      "starred-unread",
      "starred-reading",
    ]);
  });

  it("composes with search", () => {
    const searched = [
      book({ id: "match", title: "Hobbit", readingStatus: "reading" }),
      book({ id: "other-status", title: "Hobbit", readingStatus: "finished" }),
      book({ id: "other-title", title: "Dune", readingStatus: "reading" }),
    ];
    expect(
      filterByStatus(filterBooks(searched, "hobbit"), "reading").map(
        (item) => item.id,
      ),
    ).toEqual(["match"]);
  });

  it("accepts only known filters", () => {
    expect(isLibraryStatusFilter("all")).toBe(true);
    expect(isLibraryStatusFilter("starred")).toBe(true);
    expect(isLibraryStatusFilter("favourite")).toBe(false);
    expect(isLibraryStatusFilter(undefined)).toBe(false);
    expect(isLibraryStatusFilter(3)).toBe(false);
  });
});
