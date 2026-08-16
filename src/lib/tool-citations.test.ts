import { describe, expect, it } from "vitest";
import { citationsFromToolCall } from "./tool-citations";

const searchHits = [
  { chapterIndex: 2, chapterTitle: "Loomings", part: 0, snippet: "Call me Ishmael." },
  { chapterIndex: 4, snippet: "  the whiteness of the whale  " },
];

describe("citationsFromToolCall", () => {
  it("parses search hits from a reloaded session string", () => {
    expect(
      citationsFromToolCall({
        tool: "search_in_book",
        result: JSON.stringify(searchHits),
      }),
    ).toEqual([
      { citation: { kind: "chapter", chapterIndex: 2 }, label: "Loomings" },
      { citation: { kind: "chapter", chapterIndex: 4 }, label: "the whiteness of the whale" },
    ]);
  });

  it("parses live tool_end {content:[{type:text}]} payloads", () => {
    expect(
      citationsFromToolCall({
        tool: "search_in_book",
        result: { content: [{ type: "text", text: JSON.stringify(searchHits) }] },
      }),
    ).toEqual([
      { citation: { kind: "chapter", chapterIndex: 2 }, label: "Loomings" },
      { citation: { kind: "chapter", chapterIndex: 4 }, label: "the whiteness of the whale" },
    ]);
  });

  it("skips search hits without a numeric chapterIndex", () => {
    expect(
      citationsFromToolCall({
        tool: "search_in_book",
        result: JSON.stringify([
          { chapterTitle: "Missing index", snippet: "nope" },
          { chapterIndex: "1", snippet: "string index" },
          { chapterIndex: 1.5, snippet: "float" },
          { chapterIndex: 0, chapterTitle: "Ok" },
        ]),
      }),
    ).toEqual([{ citation: { kind: "chapter", chapterIndex: 0 }, label: "Ok" }]);
  });

  it("builds one read_chapter row from the result chapterIndex", () => {
    expect(
      citationsFromToolCall({
        tool: "read_chapter",
        result: JSON.stringify({ chapterIndex: 3, part: 1, text: "…" }),
        params: { chapterIndex: 9 },
      }),
    ).toEqual([{ citation: { kind: "chapter", chapterIndex: 3 }, label: "" }]);
  });

  it("falls back to read_chapter params when the result has no chapterIndex", () => {
    expect(
      citationsFromToolCall({
        tool: "read_chapter",
        result: "not-json",
        params: { chapterIndex: 6, part: 0 },
      }),
    ).toEqual([{ citation: { kind: "chapter", chapterIndex: 6 }, label: "" }]);
  });

  it("parses list_annotations bookmarks and highlights with a cfi", () => {
    expect(
      citationsFromToolCall({
        tool: "list_annotations",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                bookmarks: [
                  { id: "b1", cfi: "epubcfi(/6/8)", fraction: 0.2, label: "Loomings" },
                  { id: "b2", cfi: "  ", fraction: 0.3, label: "empty cfi" },
                ],
                highlights: [
                  { id: "h1", cfi: "epubcfi(/6/10)", excerpt: "Call me Ishmael." },
                  { id: "h2", cfi: "epubcfi(/6/12)" },
                ],
              }),
            },
          ],
        },
      }),
    ).toEqual([
      { citation: { kind: "cfi", cfi: "epubcfi(/6/8)", fraction: 0.2 }, label: "Loomings" },
      { citation: { kind: "cfi", cfi: "epubcfi(/6/10)" }, label: "Call me Ishmael." },
      { citation: { kind: "cfi", cfi: "epubcfi(/6/12)" }, label: "" },
    ]);
  });

  it("returns no citations for unknown tools, bad JSON, missing fields, or errors", () => {
    expect(citationsFromToolCall({ tool: "get_toc", result: "[]" })).toEqual([]);
    expect(citationsFromToolCall({ tool: "search_in_book", result: "{not json" })).toEqual([]);
    expect(citationsFromToolCall({ tool: "search_in_book", result: { hits: searchHits } })).toEqual([]);
    expect(citationsFromToolCall({ tool: "read_chapter", result: "{}", params: {} })).toEqual([]);
    expect(
      citationsFromToolCall({
        tool: "list_annotations",
        result: JSON.stringify({ bookmarks: [], highlights: [] }),
      }),
    ).toEqual([]);
    expect(
      citationsFromToolCall({
        tool: "search_in_book",
        result: JSON.stringify(searchHits),
        isError: true,
      }),
    ).toEqual([]);
    expect(
      citationsFromToolCall({
        tool: "read_chapter",
        params: { chapterIndex: 6, part: 0 },
        done: false,
      }),
    ).toEqual([]);
  });
});
