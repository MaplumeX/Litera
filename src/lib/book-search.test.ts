import { describe, expect, it } from "vitest";
import {
  appendSearchEvent,
  EMPTY_SEARCH_RESULTS,
  stepHit,
  type BookSearchGroup,
} from "./book-search";

const section = (label: string, ...cfis: string[]) => ({
  label,
  subitems: cfis.map((cfi) => ({ cfi, excerpt: { pre: "before ", match: "word", post: " after" } })),
});

describe("appendSearchEvent", () => {
  it("groups each section's matches under its chapter label", () => {
    let results = appendSearchEvent(EMPTY_SEARCH_RESULTS, section("Chapter 1", "a", "b"));
    results = appendSearchEvent(results, section("Chapter 3", "c"));
    expect(results.groups.map((group) => group.label)).toEqual(["Chapter 1", "Chapter 3"]);
    expect(results.total).toBe(3);
    expect(results.groups[0].hits[0]).toEqual({
      cfi: "a",
      pre: "before ",
      match: "word",
      post: " after",
    });
  });

  it("tracks scan progress and finishes at done", () => {
    let results = appendSearchEvent(EMPTY_SEARCH_RESULTS, { progress: 0.4 });
    expect(results.progress).toBe(0.4);
    results = appendSearchEvent(results, { progress: 0.2 });
    expect(results.progress).toBe(0.4);
    expect(appendSearchEvent(results, "done").progress).toBe(1);
  });

  it("stops at the hit limit and marks the results truncated", () => {
    let results = appendSearchEvent(EMPTY_SEARCH_RESULTS, section("One", "a", "b"), 3);
    results = appendSearchEvent(results, section("Two", "c", "d"), 3);
    expect(results.total).toBe(3);
    expect(results.truncated).toBe(true);
    expect(results.groups[1].hits.map((hit) => hit.cfi)).toEqual(["c"]);
    expect(appendSearchEvent(results, section("Three", "e"), 3).total).toBe(3);
  });

  it("skips malformed events and sections without matches", () => {
    expect(appendSearchEvent(EMPTY_SEARCH_RESULTS, null)).toBe(EMPTY_SEARCH_RESULTS);
    expect(appendSearchEvent(EMPTY_SEARCH_RESULTS, { label: "x", subitems: [] })).toBe(
      EMPTY_SEARCH_RESULTS,
    );
    expect(
      appendSearchEvent(EMPTY_SEARCH_RESULTS, { label: "x", subitems: [{ excerpt: {} }] }),
    ).toBe(EMPTY_SEARCH_RESULTS);
  });
});

describe("stepHit", () => {
  const groups: BookSearchGroup[] = [
    { label: "A", hits: [{ cfi: "a", pre: "", match: "", post: "" }, { cfi: "b", pre: "", match: "", post: "" }] },
    { label: "B", hits: [{ cfi: "c", pre: "", match: "", post: "" }] },
  ];

  it("starts at the first or last hit", () => {
    expect(stepHit(groups, null, 1)?.cfi).toBe("a");
    expect(stepHit(groups, null, -1)?.cfi).toBe("c");
  });

  it("moves across chapters and wraps at both ends", () => {
    expect(stepHit(groups, "b", 1)?.cfi).toBe("c");
    expect(stepHit(groups, "c", 1)?.cfi).toBe("a");
    expect(stepHit(groups, "a", -1)?.cfi).toBe("c");
  });

  it("returns null without hits", () => {
    expect(stepHit([], null, 1)).toBeNull();
  });
});
