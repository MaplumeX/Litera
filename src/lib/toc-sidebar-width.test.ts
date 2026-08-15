// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampTocWidth,
  loadTocWidth,
  saveTocWidth,
  TOC_WIDTH_DEFAULT,
  TOC_WIDTH_KEY,
  TOC_WIDTH_MIN,
} from "./toc-sidebar-width";

afterEach(() => {
  localStorage.removeItem(TOC_WIDTH_KEY);
  vi.restoreAllMocks();
});

describe("clampTocWidth", () => {
  it("clamps to the minimum", () => {
    expect(clampTocWidth(50, 800)).toBe(TOC_WIDTH_MIN);
  });

  it("clamps to the container max", () => {
    expect(clampTocWidth(900, 800)).toBe(800);
  });

  it("keeps in-range values and rounds", () => {
    expect(clampTocWidth(300, 800)).toBe(300);
    expect(clampTocWidth(300.6, 800)).toBe(301);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampTocWidth(Number.NaN, 800)).toBe(TOC_WIDTH_DEFAULT);
    expect(clampTocWidth(Number.POSITIVE_INFINITY, 800)).toBe(TOC_WIDTH_DEFAULT);
  });

  it("uses the minimum as the upper bound when the container is tiny", () => {
    expect(clampTocWidth(500, 50)).toBe(TOC_WIDTH_MIN);
  });
});

describe("loadTocWidth", () => {
  it("returns the default when nothing is saved", () => {
    expect(loadTocWidth()).toBe(TOC_WIDTH_DEFAULT);
  });

  it("reads a saved width", () => {
    localStorage.setItem(TOC_WIDTH_KEY, "300");
    expect(loadTocWidth()).toBe(300);
  });

  it("ignores invalid values", () => {
    localStorage.setItem(TOC_WIDTH_KEY, "abc");
    expect(loadTocWidth()).toBe(TOC_WIDTH_DEFAULT);
    localStorage.setItem(TOC_WIDTH_KEY, "50");
    expect(loadTocWidth()).toBe(TOC_WIDTH_DEFAULT);
  });
});

describe("saveTocWidth", () => {
  it("persists the width and round-trips through load", () => {
    saveTocWidth(300);
    expect(localStorage.getItem(TOC_WIDTH_KEY)).toBe("300");
    expect(loadTocWidth()).toBe(300);
  });
});
