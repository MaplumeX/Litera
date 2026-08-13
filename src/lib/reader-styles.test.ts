import { describe, expect, it } from "vitest";
import {
  bookSettingsSnapshot,
  generateStylesCss,
  normalizeSettings,
} from "./reader-styles";

describe("normalizeSettings", () => {
  it("uses builtin defaults when nothing is stored", () => {
    expect(normalizeSettings()).toEqual({
      fontSize: 16,
      fontFamily: "serif",
      theme: "light",
      lineHeight: "normal",
      pageMargin: "normal",
      textAlign: "start",
    });
  });

  it("keeps per-book fonts and falls back typography to preferences then builtin", () => {
    expect(
      normalizeSettings(
        { fontSize: 18, fontFamily: "monospace", lineHeight: "compact" },
        { lineHeight: "relaxed", pageMargin: "wide", theme: "sepia" },
      ),
    ).toEqual({
      fontSize: 18,
      fontFamily: "monospace",
      theme: "sepia",
      lineHeight: "compact",
      pageMargin: "wide",
      textAlign: "start",
    });
  });

  it("treats an old font-only book record as valid", () => {
    expect(normalizeSettings({ fontSize: 20, fontFamily: "sans-serif" })).toMatchObject({
      fontSize: 20,
      fontFamily: "sans-serif",
      lineHeight: "normal",
      pageMargin: "normal",
      textAlign: "start",
    });
  });
});

describe("generateStylesCss", () => {
  it("injects line-height, measure, and alignment on html, body", () => {
    const css = generateStylesCss({
      fontSize: 16,
      fontFamily: "serif",
      theme: "light",
      lineHeight: "relaxed",
      pageMargin: "narrow",
      textAlign: "justify",
    });
    expect(css).toContain("font-family: serif");
    expect(css).toContain("font-size: 16px !important");
    expect(css).toContain("line-height: 2.0");
    expect(css).toContain("max-width: 36em");
    expect(css).toContain("margin-inline: auto");
    expect(css).toContain("padding-inline: 1.25rem");
    expect(css).toContain("text-align: justify");
  });
});

describe("bookSettingsSnapshot", () => {
  it("keeps remaining typography overrides when restoring one key", () => {
    expect(
      bookSettingsSnapshot(
        { fontSize: 18, fontFamily: "serif" },
        { lineHeight: "compact", pageMargin: "wide", textAlign: "justify" },
        "lineHeight",
      ),
    ).toEqual({
      fontSize: 18,
      fontFamily: "serif",
      pageMargin: "wide",
      textAlign: "justify",
    });
  });
});
