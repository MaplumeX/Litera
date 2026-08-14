import { describe, expect, it } from "vitest";
import { fractionFromPointer } from "./reader-progress";

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
