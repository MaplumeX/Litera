import { describe, expect, it } from "vitest";
import {
  bookSettingsSnapshot,
  footnotePopupCss,
  generatePreviewCss,
  generateStylesCss,
  isTypographyOverridden,
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
      columnCount: 2,
      overrideFont: false,
      overrideLayout: false,
    });
  });

  it("keeps per-book overrides and falls back the rest to preferences then builtin", () => {
    expect(
      normalizeSettings(
        { fontSize: 18, fontFamily: "monospace", lineHeight: "compact" },
        { lineHeight: 2.0, contentWidth: 52, theme: "system", fontSize: 14, fontFamily: "sans-serif" },
      ),
    ).toEqual({
      fontSize: 18,
      fontFamily: "monospace",
      theme: "system",
      lineHeight: 1.4,
      contentWidth: 52,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
      columnCount: 2,
      overrideFont: false,
      overrideLayout: false,
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

  it("normalizes columnCount with defaults, clamping, and override precedence", () => {
    // missing everywhere → default 2
    expect(normalizeSettings()).toMatchObject({ columnCount: 2 });
    // out-of-range clamps via clampSnap
    expect(normalizeSettings({ columnCount: 0 })).toMatchObject({ columnCount: 1 });
    expect(normalizeSettings({ columnCount: 4 })).toMatchObject({ columnCount: 3 });
    // non-integer snaps to the nearest step
    expect(normalizeSettings({ columnCount: 2.6 })).toMatchObject({ columnCount: 3 });
    // book override wins over preference
    expect(normalizeSettings({ columnCount: 1 }, { columnCount: 3 })).toMatchObject({
      columnCount: 1,
    });
    // falls back to preference when the book has none
    expect(normalizeSettings({}, { columnCount: 3 })).toMatchObject({ columnCount: 3 });
    // non-numeric garbage falls back to the default
    expect(normalizeSettings({ columnCount: undefined }, { columnCount: undefined })).toMatchObject({
      columnCount: 2,
    });
  });

  it("resolves override flags as book ?? preferences ?? false", () => {
    expect(normalizeSettings()).toMatchObject({
      overrideFont: false,
      overrideLayout: false,
    });
    expect(
      normalizeSettings({}, { overrideFont: true, overrideLayout: true }),
    ).toMatchObject({
      overrideFont: true,
      overrideLayout: true,
    });
    expect(
      normalizeSettings(
        { overrideFont: false, overrideLayout: true },
        { overrideFont: true, overrideLayout: false },
      ),
    ).toMatchObject({
      overrideFont: false,
      overrideLayout: true,
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
      overrideFont: false,
      overrideLayout: false,
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
    expect(css).not.toContain("Geist");
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
      overrideFont: false,
      overrideLayout: false,
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
      overrideFont: false,
      overrideLayout: false,
    });
    expect(css).toContain('font-family: "Foo\\\\Bar \\"Q\\"", serif');
  });

  it("keeps today's stylesheet when both override flags are off", () => {
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
      overrideFont: false,
      overrideLayout: false,
    });
    expect(css).toBe(
      "html, body { font-family: serif; font-size: 16px !important; line-height: 2; letter-spacing: 0.02em; max-width: 36em; margin-inline: auto; padding-inline: 1.25rem; text-align: justify; }\n" +
        "p { margin-block-end: 1.1em !important; text-indent: 2em !important; }",
    );
    expect(css).not.toContain("font-family: serif !important");
    expect(css).not.toContain("code, kbd, pre, samp");
    expect(css).not.toContain("line-height: 2 !important");
    expect(css).not.toContain("Geist");
  });

  it("forces the user font on body text and headings, keeping code monospace", () => {
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
      overrideFont: true,
      overrideLayout: false,
    });
    expect(css).toContain(
      'html, body, p, div, span, li, blockquote, td, th, a, h1, h2, h3, h4, h5, h6 { font-family: "Noto Sans", serif !important; }',
    );
    expect(css).toContain("code, kbd, pre, samp { font-family: monospace !important; }");
    expect(css).toContain("max-width: 42em");
    expect(css).toContain("padding-inline: 1.75rem");
    expect(css).not.toContain("line-height: 1.7 !important");
    expect(css).not.toContain("Geist");
  });

  it("forces layout on body-text elements without flattening headings", () => {
    const css = generateStylesCss({
      fontSize: 18,
      fontFamily: "serif",
      theme: "light",
      lineHeight: 2,
      contentWidth: 36,
      pagePadding: 1.25,
      textAlign: "justify",
      letterSpacing: 0.02,
      paragraphSpacing: 1.1,
      firstLineIndent: 2,
      overrideFont: false,
      overrideLayout: true,
    });
    expect(css).toContain(
      "html, body, p, div, li, blockquote { font-size: 18px !important; line-height: 2 !important; letter-spacing: 0.02em !important; text-align: justify !important; }",
    );
    expect(css).toContain("margin-block-end: 1.1em !important");
    expect(css).toContain("text-indent: 2em !important");
    expect(css).toContain("max-width: 36em");
    expect(css).toContain("padding-inline: 1.25rem");
    expect(css).not.toContain("h1, h2, h3, h4, h5, h6");
    expect(css).not.toContain("code, kbd, pre, samp");
    expect(css).not.toContain("font-family: serif !important");
    expect(css).not.toContain("Geist");
  });

  it("can enable font override without layout override and the reverse", () => {
    const fontOnly = generateStylesCss({
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
      overrideFont: true,
      overrideLayout: false,
    });
    expect(fontOnly).toContain("h1, h2, h3, h4, h5, h6");
    expect(fontOnly).toContain("code, kbd, pre, samp");
    expect(fontOnly).not.toContain("line-height: 1.7 !important");

    const layoutOnly = generateStylesCss({
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
      overrideFont: false,
      overrideLayout: true,
    });
    expect(layoutOnly).toContain("line-height: 1.7 !important");
    expect(layoutOnly).not.toContain("h1, h2, h3, h4, h5, h6");
    expect(layoutOnly).not.toContain("code, kbd, pre, samp");
  });

  it("applies font and layout overrides together without flattening headings or code", () => {
    const css = generateStylesCss({
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
      overrideFont: true,
      overrideLayout: true,
    });
    expect(css).toContain(
      "html, body, p, div, span, li, blockquote, td, th, a, h1, h2, h3, h4, h5, h6 { font-family: serif !important; }",
    );
    expect(css).toContain("code, kbd, pre, samp { font-family: monospace !important; }");
    expect(css).toContain(
      "html, body, p, div, li, blockquote { font-size: 16px !important; line-height: 1.7 !important; letter-spacing: 0em !important; text-align: start !important; }",
    );
    expect(css).toContain("max-width: 42em");
    expect(css).toContain("padding-inline: 1.75rem");
    expect(css).not.toContain("Geist");
  });
});

const DARK_STYLES = {
  fontSize: 16,
  fontFamily: "serif",
  theme: "dark",
  lineHeight: 1.7,
  contentWidth: 42,
  pagePadding: 1.75,
  textAlign: "start" as const,
  letterSpacing: 0,
  paragraphSpacing: 1,
  firstLineIndent: 2,
  overrideFont: false,
  overrideLayout: false,
};

describe("footnotePopupCss", () => {
  it("clears page chrome and first-line indent", () => {
    const css = footnotePopupCss();
    expect(css).toContain("background: transparent !important");
    expect(css).toContain("min-height: 0 !important");
    expect(css).toContain("height: auto !important");
    expect(css).toContain("max-width: none !important");
    expect(css).toContain("margin-inline: 0 !important");
    expect(css).toContain("padding: 0.75rem !important");
    expect(css).toContain("text-indent: 0 !important");
    expect(css).toContain("margin-block-end: 0.5em !important");
  });

  it("wins over generateStylesCss text-indent and dark background when appended", () => {
    const combined = `${generateStylesCss(DARK_STYLES)}\n${footnotePopupCss()}`;
    expect(combined).toContain("text-indent: 2em !important");
    expect(combined).toContain("background: #1a1a1a !important");
    expect(combined.lastIndexOf("text-indent: 0 !important")).toBeGreaterThan(
      combined.lastIndexOf("text-indent: 2em !important"),
    );
    expect(combined.lastIndexOf("background: transparent !important")).toBeGreaterThan(
      combined.lastIndexOf("background: #1a1a1a !important"),
    );
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

  it("treats book false as a real override and can omit it", () => {
    expect(isTypographyOverridden({ overrideFont: false }, "overrideFont")).toBe(true);
    expect(isTypographyOverridden({ overrideLayout: true }, "overrideLayout")).toBe(true);
    expect(isTypographyOverridden({}, "overrideFont")).toBe(false);
    expect(
      bookSettingsSnapshot({ overrideFont: false, overrideLayout: true }),
    ).toEqual({
      overrideFont: false,
      overrideLayout: true,
    });
    expect(
      bookSettingsSnapshot({ overrideFont: false, textAlign: "justify" }, undefined, "overrideFont"),
    ).toEqual({
      textAlign: "justify",
    });
  });

  it("treats columnCount as a real override and can omit it to restore the default", () => {
    expect(isTypographyOverridden({ columnCount: 3 }, "columnCount")).toBe(true);
    expect(isTypographyOverridden({}, "columnCount")).toBe(false);
    expect(bookSettingsSnapshot({ columnCount: 1 })).toEqual({ columnCount: 1 });
    expect(
      bookSettingsSnapshot({ columnCount: 1, textAlign: "justify" }, undefined, "columnCount"),
    ).toEqual({ textAlign: "justify" });
  });
});

describe("generatePreviewCss", () => {
  it("scopes selectors to .litera-typography-preview and includes typography props", () => {
    const css = generatePreviewCss({
      fontSize: 18,
      fontFamily: "serif",
      theme: "light",
      lineHeight: 2,
      contentWidth: 36,
      pagePadding: 1.25,
      textAlign: "justify",
      letterSpacing: 0.02,
      paragraphSpacing: 1.1,
      firstLineIndent: 2,
      overrideFont: true,
      overrideLayout: true,
    });
    expect(css).toContain(".litera-typography-preview {");
    expect(css).toContain(".litera-typography-preview p {");
    expect(css).toContain("font-family: serif;");
    expect(css).toContain("font-size: 18px");
    expect(css).toContain("line-height: 2");
    expect(css).toContain("letter-spacing: 0.02em");
    expect(css).toContain("max-width: 36em");
    expect(css).toContain("margin-inline: auto");
    expect(css).toContain("padding-inline: 1.25rem");
    expect(css).toContain("text-align: justify");
    expect(css).toContain("margin-block-end: 1.1em");
    expect(css).toContain("text-indent: 2em");
  });

  it("does not inject html/body selectors or global background/color", () => {
    const css = generatePreviewCss({
      fontSize: 16,
      fontFamily: "serif",
      theme: "dark",
      lineHeight: 1.7,
      contentWidth: 42,
      pagePadding: 1.75,
      textAlign: "start",
      letterSpacing: 0,
      paragraphSpacing: 1,
      firstLineIndent: 0,
      overrideFont: true,
      overrideLayout: true,
    });
    expect(css).not.toContain("html, body");
    expect(css).not.toContain("html,body");
    expect(css).not.toContain("background");
    expect(css).not.toContain("!important");
  });

  it("quotes named fonts via cssFontFamily and never emits Geist", () => {
    const css = generatePreviewCss({
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
      overrideFont: true,
      overrideLayout: false,
    });
    expect(css).toContain('font-family: "Noto Sans", serif');
    expect(css).not.toContain("Geist");
  });
});
