import { describe, expect, it } from "vitest";
import { citationChapterIndex, isCitationHref, quoteSearchQueries, stripCitations } from "./citations";

describe("citation markers", () => {
  it("recognizes cite: links and parses the chapter index", () => {
    expect(isCitationHref("cite:12")).toBe(true);
    expect(isCitationHref("https://example.com")).toBe(false);
    expect(isCitationHref(undefined)).toBe(false);
    expect(citationChapterIndex("cite:12")).toBe(12);
    expect(citationChapterIndex("cite:abc")).toBe(-1);
    expect(citationChapterIndex("cite:-1")).toBe(-1);
    expect(citationChapterIndex("cite:")).toBe(-1);
  });

  it("strips citation links to their quote for copying", () => {
    expect(stripCitations("作者认为[“自由不是没有约束”](cite:12)，并且[链接](https://a.b)。")).toBe(
      "作者认为“自由不是没有约束”，并且[链接](https://a.b)。",
    );
  });
});

describe("quoteSearchQueries", () => {
  it("uses the longest ellipsis-free segment, then a shorter head", () => {
    expect(quoteSearchQueries("“开头……这是更长的一段中间文字，超过二十个字符的那种长度啊”")).toEqual([
      "这是更长的一段中间文字，超过二十个字符的那种长度啊",
      "这是更长的一段中间文字，超过二十个字符的",
    ]);
  });

  it("returns a single query for short quotes and none for empty ones", () => {
    expect(quoteSearchQueries("「短句」")).toEqual(["短句"]);
    expect(quoteSearchQueries("“……”")).toEqual([]);
  });
});
