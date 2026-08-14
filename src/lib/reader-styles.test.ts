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
      lineHeight: 1.7,
      contentWidth: 42,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
    });
  });

  it("keeps per-book overrides and falls back the rest to preferences then builtin", () => {
    expect(
      normalizeSettings(
        { fontSize: 18, fontFamily: "monospace", lineHeight: "compact" },
        { lineHeight: 2.0, contentWidth: 52, theme: "sepia", fontSize: 14, fontFamily: "sans-serif" },
      ),
    ).toEqual({
      fontSize: 18,
      fontFamily: "monospace",
      theme: "sepia",
      lineHeight: 1.4,
      contentWidth: 52,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
    });
  });

  it("uses preference fonts when the book has no font override", () => {
    expect(normalizeSettings({}, { fontSize: 20, fontFamily: "sans-serif" })).toMatchObject({
      fontSize: 20,
      fontFamily: "sans-serif",
    });
  });

  it("treats an old font-only book record as valid", () => {
    expect(normalizeSettings({ fontSize: 20, fontFamily: "sans-serif" })).toMatchObject({
      fontSize: 20,
      fontFamily: "sans-serif",
      lineHeight: 1.7,
      contentWidth: 42,
      pagePadding: 1.75,
      textAlign: "start",
    });
  });

  it("maps leftover lineHeight and pageMargin enums", () => {
    expect(
      normalizeSettings({ lineHeight: "compact", pageMargin: "wide" }),
    ).toMatchObject({
      lineHeight: 1.4,
      contentWidth: 52,
      pagePadding: 2.5,
    });
  });

  it("lets stored contentWidth and pagePadding win over leftover pageMargin", () => {
    expect(
      normalizeSettings({ pageMargin: "wide", contentWidth: 30, pagePadding: 0.75 }),
    ).toMatchObject({
      contentWidth: 30,
      pagePadding: 0.75,
    });
  });

  it("keeps a valid named font family", () => {
    expect(normalizeSettings({ fontFamily: "Noto Sans" })).toMatchObject({
      fontFamily: "Noto Sans",
    });
    expect(
      normalizeSettings({}, { fontFamily: "Source Han Serif" }),
    ).toMatchObject({
      fontFamily: "Source Han Serif",
    });
  });

  it("falls back to serif for illegal font names", () => {
    expect(normalizeSettings({ fontFamily: "bad;font" })).toMatchObject({
      fontFamily: "serif",
    });
    expect(normalizeSettings({ fontFamily: "" })).toMatchObject({
      fontFamily: "serif",
    });
  });
});

describe("generateStylesCss", () => {
  it("injects typography, measure, spacing, and paragraph rules", () => {
    const css = generateStylesCss({
      fontSize: 16,
      fontFamily: "serif",
      theme: "light",
      lineHeight: 2,
      contentWidth: 36,
      pagePadding: 1.25,
      textAlign: "justify",
      letterSpacing: 0.02,
      paragraphSpacing: 1.1,
      firstLineIndent: 2,
    });
    expect(css).toContain("font-family: serif;");
    expect(css).not.toContain("font-family: serif,");
    expect(css).toContain("font-size: 16px !important");
    expect(css).toContain("line-height: 2");
    expect(css).toContain("letter-spacing: 0.02em");
    expect(css).toContain("max-width: 36em");
    expect(css).toContain("margin-inline: auto");
    expect(css).toContain("padding-inline: 1.25rem");
    expect(css).toContain("text-align: justify");
    expect(css).toContain("margin-block-end: 1.1em !important");
    expect(css).toContain("text-indent: 2em !important");
  });

  it("quotes named fonts and appends a serif fallback", () => {
    const css = generateStylesCss({
      fontSize: 16,
      fontFamily: "Noto Sans",
      theme: "light",
      lineHeight: 1.7,
      contentWidth: 42,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
    });
    expect(css).toContain('font-family: "Noto Sans", serif');
    expect(css).not.toContain("font-family: Noto Sans;");
  });

  it("escapes quotes and backslashes in named fonts", () => {
    const css = generateStylesCss({
      fontSize: 16,
      fontFamily: 'Foo\\Bar "Q"',
      theme: "light",
      lineHeight: 1.7,
      contentWidth: 42,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
    });
    expect(css).toContain('font-family: "Foo\\\\Bar \\"Q\\"", serif');
  });
});

describe("bookSettingsSnapshot", () => {
  it("writes only overridden keys and never emits pageMargin or theme", () => {
    expect(
      bookSettingsSnapshot(
        {
          fontSize: 18,
          fontFamily: "serif",
          lineHeight: "compact",
          pageMargin: "wide",
          textAlign: "justify",
          theme: "dark",
        },
        undefined,
        "lineHeight",
      ),
    ).toEqual({
      fontSize: 18,
      fontFamily: "serif",
      contentWidth: 52,
      pagePadding: 2.5,
      textAlign: "justify",
    });
  });

  it("can omit fonts when they are not overridden", () => {
    expect(bookSettingsSnapshot({ textAlign: "justify" })).toEqual({
      textAlign: "justify",
    });
  });
});
