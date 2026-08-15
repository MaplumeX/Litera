import { describe, expect, it } from "vitest";
import { chapterNavAt, flattenToc, type TocTreeItem } from "./toc-items";

const toc: TocTreeItem[] = [
  {
    href: "p1",
    label: "Part 1",
    subitems: [
      { href: "c1", label: "Chapter 1" },
      { href: "c2", label: "Chapter 2" },
    ],
  },
  { href: "p2", label: "Part 2" },
  { href: "", label: "No href" },
];

describe("flattenToc", () => {
  it("walks depth-first and skips empty hrefs", () => {
    expect(flattenToc(toc)).toEqual([
      { href: "p1", label: "Part 1" },
      { href: "c1", label: "Chapter 1" },
      { href: "c2", label: "Chapter 2" },
      { href: "p2", label: "Part 2" },
    ]);
  });

  it("returns an empty list for an empty TOC", () => {
    expect(flattenToc([])).toEqual([]);
  });
});

describe("chapterNavAt", () => {
  it("disables both ends when the TOC is empty", () => {
    expect(chapterNavAt([], "c1")).toEqual({ canPrev: false, canNext: false });
  });

  it("disables both ends when the href is missing from the TOC", () => {
    expect(chapterNavAt(toc, "missing")).toEqual({ canPrev: false, canNext: false });
    expect(chapterNavAt(toc)).toEqual({ canPrev: false, canNext: false });
  });

  it("walks neighbors by flattened href", () => {
    expect(chapterNavAt(toc, "c1")).toEqual({
      canPrev: true,
      canNext: true,
      prevHref: "p1",
      nextHref: "c2",
    });
    expect(chapterNavAt(toc, "p1")).toEqual({
      canPrev: false,
      canNext: true,
      nextHref: "c1",
    });
    expect(chapterNavAt(toc, "p2")).toEqual({
      canPrev: true,
      canNext: false,
      prevHref: "c2",
    });
  });
});