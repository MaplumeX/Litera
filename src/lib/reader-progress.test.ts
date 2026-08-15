import { describe, expect, it } from "vitest";
import { fractionFromPointer, movedPastSlop, sectionIndexAt } from "./reader-progress";

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
