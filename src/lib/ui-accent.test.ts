// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UI_ACCENT,
  UI_ACCENT_KEY,
  applyUiAccent,
  loadUiAccent,
  parseUiAccent,
  saveUiAccent,
} from "@/lib/ui-accent";

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
});

describe("ui accent", () => {
  it("falls back to the default for anything unknown", () => {
    expect(parseUiAccent("pine")).toBe("pine");
    expect(parseUiAccent("hotpink")).toBe(DEFAULT_UI_ACCENT);
    expect(parseUiAccent(null)).toBe(DEFAULT_UI_ACCENT);
  });

  it("round-trips through storage", () => {
    expect(loadUiAccent()).toBe(DEFAULT_UI_ACCENT);
    saveUiAccent("violet");
    expect(localStorage.getItem(UI_ACCENT_KEY)).toBe("violet");
    expect(loadUiAccent()).toBe("violet");
  });

  it("publishes the accent on the root element", () => {
    applyUiAccent("amber");
    expect(document.documentElement.dataset.accent).toBe("amber");
  });
});
