import { describe, expect, it } from "vitest";
import {
  ancestorKeysForHref,
  chapterNavAt,
  collapsibleKeys,
  flattenToc,
  tocPathKey,
  unionKeys,
  type TocTreeItem,
} from "./toc-items";

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

const nested: TocTreeItem[] = [
  {
    href: "p1",
    label: "Part 1",
    subitems: [
      { href: "c1", label: "Chapter 1" },
      {
        href: "c2",
        label: "Chapter 2",
        subitems: [{ href: "s1", label: "Section 1" }],
      },
    ],
  },
  { href: "p2", label: "Part 2" },
  {
    href: "dup",
    label: "Dup A",
    subitems: [{ href: "dup", label: "Dup nested" }],
  },
  {
    href: "other",
    label: "Other",
    subitems: [{ href: "dup", label: "Dup elsewhere" }],
  },
];

describe("tocPathKey", () => {
  it("joins sibling indexes with dots", () => {
    expect(tocPathKey([0, 2, 1])).toBe("0.2.1");
    expect(tocPathKey([0])).toBe("0");
  });
});

describe("collapsibleKeys", () => {
  it("returns DFS keys for rows with children", () => {
    expect(collapsibleKeys(nested)).toEqual(["0", "0.1", "2", "3"]);
    expect(collapsibleKeys([])).toEqual([]);
    expect(collapsibleKeys([{ href: "leaf", label: "Leaf" }])).toEqual([]);
  });
});

describe("ancestorKeysForHref", () => {
  it("returns collapsible ancestors of a nested match, not the row itself", () => {
    expect(ancestorKeysForHref(nested, "s1")).toEqual(["0", "0.1"]);
    expect(ancestorKeysForHref(nested, "c1")).toEqual(["0"]);
    expect(ancestorKeysForHref(nested, "p1")).toEqual([]);
  });

  it("unions ancestors of every duplicate href match", () => {
    expect(ancestorKeysForHref(nested, "dup")).toEqual(["2", "3"]);
  });

  it("returns an empty list when the href is missing or unmatched", () => {
    expect(ancestorKeysForHref(nested)).toEqual([]);
    expect(ancestorKeysForHref(nested, "")).toEqual([]);
    expect(ancestorKeysForHref(nested, "missing")).toEqual([]);
  });
});

describe("unionKeys", () => {
  it("keeps extra current keys and appends unseen ones", () => {
    expect(unionKeys(["0", "extra"], ["0", "1"])).toEqual(["0", "extra", "1"]);
  });

  it("returns the same array when nothing is added", () => {
    const current = ["0", "1"];
    expect(unionKeys(current, ["0"])).toBe(current);
    expect(unionKeys(current, [])).toBe(current);
  });
});
