// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { GUIDED_STYLE_MAX_CHARS } from "@/agent/runtime/guide";
import { GUIDED_STYLE_KEY, loadGuidedStyle, saveGuidedStyle } from "./guided-style";

afterEach(() => localStorage.clear());

describe("guided style preference", () => {
  it("is null until the reader saves one", () => {
    expect(loadGuidedStyle()).toBeNull();
    saveGuidedStyle("Use tables.");
    expect(loadGuidedStyle()).toBe("Use tables.");
  });

  it("restores the default on an empty or null save", () => {
    saveGuidedStyle("Use tables.");
    saveGuidedStyle("   ");
    expect(localStorage.getItem(GUIDED_STYLE_KEY)).toBeNull();
    saveGuidedStyle("Use tables.");
    saveGuidedStyle(null);
    expect(loadGuidedStyle()).toBeNull();
  });

  it("ignores an oversized stored value", () => {
    localStorage.setItem(GUIDED_STYLE_KEY, "x".repeat(GUIDED_STYLE_MAX_CHARS + 1));
    expect(loadGuidedStyle()).toBeNull();
  });
});
