import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../foliate-js/view.js", () => ({
  makeBook: vi.fn(),
}));

import { makeBook } from "../foliate-js/view.js";
import {
  MAX_AUTHOR_BYTES,
  MAX_DESCRIPTION_BYTES,
  extractEpubMetadata,
  extractFirstValue,
  extractLanguage,
  extractSeries,
  stripHtmlToPlainText,
  truncateUtf8Bytes,
} from "./book-utils";

const makeBookMock = vi.mocked(makeBook);

describe("extractFirstValue", () => {
  it("reads a string, language map, value object, and array", () => {
    expect(extractFirstValue(null)).toBeNull();
    expect(extractFirstValue("Title")).toBe("Title");
    expect(extractFirstValue({ en: "Title", zh: "书名" })).toBe("Title");
    expect(extractFirstValue({ value: "From object" })).toBe("From object");
    expect(extractFirstValue([{ lang: "en", value: "First" }])).toBe("First");
    expect(extractFirstValue(["plain"])).toBe("plain");
  });
});

describe("stripHtmlToPlainText", () => {
  it("strips tags and collapses whitespace", () => {
    expect(stripHtmlToPlainText("<p>Hello<br/>world</p>")).toBe("Hello world");
    expect(stripHtmlToPlainText("  already   plain  ")).toBe("already plain");
    expect(stripHtmlToPlainText("")).toBe("");
  });
});

describe("extractLanguage", () => {
  it("uses a string or joins a non-empty array", () => {
    expect(extractLanguage("en")).toBe("en");
    expect(extractLanguage(["en", " zh "])).toBe("en, zh");
    expect(extractLanguage(["", "en", 1, null])).toBe("en");
    expect(extractLanguage(undefined)).toBe("");
  });
});

describe("extractSeries", () => {
  it("stores the name, and appends a finite position", () => {
    expect(extractSeries(undefined)).toBe("");
    expect(extractSeries({ series: { name: "Saga" } })).toBe("Saga");
    expect(extractSeries({ series: { name: "Saga", position: 2 } })).toBe("Saga · 2");
    expect(extractSeries({ series: { name: "Saga", position: Number.NaN } })).toBe("Saga");
    expect(extractSeries({ series: [{ name: { en: "Saga" }, position: 1 }] })).toBe(
      "Saga · 1",
    );
    expect(extractSeries({ series: "Plain" })).toBe("Plain");
  });
});

describe("truncateUtf8Bytes", () => {
  it("keeps strings under the cap and does not split a code point", () => {
    expect(truncateUtf8Bytes("hello", 5)).toBe("hello");
    expect(truncateUtf8Bytes("éé", 2)).toBe("é");
    expect(truncateUtf8Bytes("简介", 3)).toBe("简");
    expect(truncateUtf8Bytes("abc", 0)).toBe("");
    expect(truncateUtf8Bytes("x".repeat(MAX_AUTHOR_BYTES + 8), MAX_AUTHOR_BYTES).length).toBe(
      MAX_AUTHOR_BYTES,
    );
    expect(
      new TextEncoder().encode(
        truncateUtf8Bytes("y".repeat(MAX_DESCRIPTION_BYTES + 1), MAX_DESCRIPTION_BYTES),
      ).length,
    ).toBe(MAX_DESCRIPTION_BYTES);
  });
});

describe("extractEpubMetadata", () => {
  beforeEach(() => {
    makeBookMock.mockReset();
  });

  it("extracts extra shelf fields from foliate metadata", async () => {
    makeBookMock.mockResolvedValue({
      metadata: {
        title: "T",
        author: "A",
        description: "<p>Hello</p>  world",
        publisher: { en: "Pub" },
        language: ["en", "zh"],
        belongsTo: { series: { name: "Saga", position: 2 } },
      },
      getCover: async () => null,
      destroy: () => {},
      sections: [],
    });

    await expect(extractEpubMetadata(new Uint8Array(), "x.epub")).resolves.toEqual({
      title: "T",
      author: "A",
      description: "Hello world",
      publisher: "Pub",
      language: "en, zh",
      series: "Saga · 2",
      coverBytes: null,
    });
  });

  it("treats missing extra fields as empty strings", async () => {
    makeBookMock.mockResolvedValue({
      metadata: { title: "T" },
      destroy: () => {},
      sections: [],
    });

    const result = await extractEpubMetadata(new Uint8Array(), "x.epub");
    expect(result.description).toBe("");
    expect(result.publisher).toBe("");
    expect(result.language).toBe("");
    expect(result.series).toBe("");
    expect(result.title).toBe("T");
  });
});
