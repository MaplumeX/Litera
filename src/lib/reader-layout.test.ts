import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_LAYOUT,
  isReaderLayout,
  resolveReaderLayout,
} from "./reader-layout";

describe("isReaderLayout", () => {
  it("accepts a complete boolean snapshot", () => {
    expect(
      isReaderLayout({
        chatCollapsed: false,
        bookCollapsed: true,
        sessionRailOpen: false,
      }),
    ).toBe(true);
  });

  it("rejects missing keys, non-bools, and non-objects", () => {
    expect(isReaderLayout(undefined)).toBe(false);
    expect(isReaderLayout(null)).toBe(false);
    expect(isReaderLayout({ chatCollapsed: true, bookCollapsed: false })).toBe(false);
    expect(
      isReaderLayout({
        chatCollapsed: "true",
        bookCollapsed: false,
        sessionRailOpen: true,
      }),
    ).toBe(false);
  });
});

describe("resolveReaderLayout", () => {
  it("returns first-open defaults when nothing is saved", () => {
    expect(resolveReaderLayout(undefined)).toEqual(DEFAULT_READER_LAYOUT);
    expect(resolveReaderLayout(null)).toEqual({
      chatCollapsed: true,
      bookCollapsed: false,
      sessionRailOpen: true,
    });
  });

  it("returns the saved snapshot when all three flags are present", () => {
    const saved = {
      chatCollapsed: false,
      bookCollapsed: true,
      sessionRailOpen: false,
    };
    expect(resolveReaderLayout(saved)).toEqual(saved);
  });
});
