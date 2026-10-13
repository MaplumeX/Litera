import { describe, expect, it } from "vitest";
import {
  chapterBoundsAt,
  chapterTicks,
  fractionFromPointer,
  movedPastSlop,
  percentOf,
  sectionIndexAt,
} from "./reader-progress";

describe("fractionFromPointer", () => {
  it("maps the left edge to 0", () => {
    expect(fractionFromPointer(100, 100, 200)).toBe(0);
  });

  it("maps the right edge to 1", () => {
    expect(fractionFromPointer(300, 100, 200)).toBe(1);
  });

  it("maps the midpoint to 0.5", () => {
    expect(fractionFromPointer(200, 100, 200)).toBe(0.5);
  });

  it("clamps past the left edge to 0", () => {
    expect(fractionFromPointer(50, 100, 200)).toBe(0);
  });

  it("clamps past the right edge to 1", () => {
    expect(fractionFromPointer(400, 100, 200)).toBe(1);
  });

  it("returns 0 when width is not positive", () => {
    expect(fractionFromPointer(150, 100, 0)).toBe(0);
    expect(fractionFromPointer(150, 100, -10)).toBe(0);
  });
});

describe("movedPastSlop", () => {
  it("treats a small move as a click", () => {
    expect(movedPastSlop(2)).toBe(false);
    expect(movedPastSlop(-2)).toBe(false);
  });

  it("treats a 3px move as a drag", () => {
    expect(movedPastSlop(3)).toBe(true);
    expect(movedPastSlop(-4)).toBe(true);
  });
});

describe("sectionIndexAt", () => {
  const ticks = [0, 0.25, 0.5, 1];

  it("returns undefined when there are fewer than two ticks", () => {
    expect(sectionIndexAt(0.3, [])).toBeUndefined();
    expect(sectionIndexAt(0.3, [0])).toBeUndefined();
  });

  it("maps a fraction onto the last section start at or before it", () => {
    expect(sectionIndexAt(0, ticks)).toBe(0);
    expect(sectionIndexAt(0.24, ticks)).toBe(0);
    expect(sectionIndexAt(0.25, ticks)).toBe(1);
    expect(sectionIndexAt(0.49, ticks)).toBe(1);
    expect(sectionIndexAt(0.5, ticks)).toBe(2);
    expect(sectionIndexAt(1, ticks)).toBe(2);
  });
});

describe("percentOf", () => {
  it("rounds down so the last pages never read 100%", () => {
    expect(percentOf(0.995)).toBe(99);
    expect(percentOf(0.4299)).toBe(42);
  });

  it("reads 100% only at the end", () => {
    expect(percentOf(1)).toBe(100);
  });

  it("absorbs float noise", () => {
    expect(percentOf(0.29)).toBe(29);
    expect(percentOf(0.57)).toBe(57);
  });

  it("clamps out-of-range fractions", () => {
    expect(percentOf(-0.1)).toBe(0);
    expect(percentOf(1.2)).toBe(100);
  });
});

describe("chapterTicks", () => {
  const sections = [0, 0.1, 0.3, 0.6, 1];

  it("drops ticks for sections that continue the previous chapter", () => {
    const toc = ["front", "ch1", "ch1", "ch2"];
    expect(chapterTicks(sections, (i) => toc[i])).toEqual([0, 0.1, 0.6, 1]);
  });

  it("merges leading sections without a TOC entry into one", () => {
    const toc = [null, null, "ch1", "ch2"];
    expect(chapterTicks(sections, (i) => toc[i])).toEqual([0, 0.3, 0.6, 1]);
  });

  it("skips empty sections that would stack two ticks", () => {
    const toc = ["ch1", "note", "ch2"];
    expect(chapterTicks([0, 0.5, 0.5, 1], (i) => toc[i])).toEqual([0, 0.5, 1]);
  });

  it("keeps section ticks when nothing maps to the TOC", () => {
    expect(chapterTicks(sections, () => undefined)).toEqual(sections);
  });

  it("passes short tick lists through", () => {
    expect(chapterTicks([], () => "x")).toEqual([]);
  });
});

describe("chapterBoundsAt", () => {
  const ticks = [0, 0.25, 0.5, 1];

  it("returns the chapter around a fraction", () => {
    expect(chapterBoundsAt(0.3, ticks)).toEqual({ start: 0.25, end: 0.5 });
    expect(chapterBoundsAt(1, ticks)).toEqual({ start: 0.5, end: 1 });
  });

  it("returns undefined without ticks", () => {
    expect(chapterBoundsAt(0.3, [])).toBeUndefined();
  });
});
