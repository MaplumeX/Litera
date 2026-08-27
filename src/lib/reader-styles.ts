import type { ReadingSettings } from "@/types/library";

export const FONT_FAMILIES = [
  { value: "serif", label: "衬线", css: "serif" },
  { value: "sans-serif", label: "无衬线", css: "sans-serif" },
  { value: "monospace", label: "等宽", css: "monospace" },
] as const;
export const THEMES = ["light", "dark", "system"] as const;
export const TEXT_ALIGNS = [
  { value: "start", label: "左齐" },
  { value: "justify", label: "两端" },
] as const;

export type TextAlignValue = (typeof TEXT_ALIGNS)[number]["value"];
export type TypographyKey =
  | "fontSize"
  | "fontFamily"
  | "lineHeight"
  | "contentWidth"
  | "pagePadding"
  | "textAlign"
  | "letterSpacing"
  | "paragraphSpacing"
  | "firstLineIndent"
  | "columnCount"
  | "overrideFont"
  | "overrideLayout";

export const TYPOGRAPHY_KEYS: TypographyKey[] = [
  "fontSize",
  "fontFamily",
  "lineHeight",
  "contentWidth",
  "pagePadding",
  "textAlign",
  "letterSpacing",
  "paragraphSpacing",
  "firstLineIndent",
  "columnCount",
  "overrideFont",
  "overrideLayout",
];

export const TYPOGRAPHY_RANGES = {
  fontSize: { min: 12, max: 32, step: 1, unit: "px" },
  lineHeight: { min: 1.2, max: 2.4, step: 0.05, unit: "" },
  contentWidth: { min: 28, max: 60, step: 1, unit: "em" },
  pagePadding: { min: 0.5, max: 4, step: 0.25, unit: "rem" },
  letterSpacing: { min: -0.05, max: 0.2, step: 0.01, unit: "em" },
  paragraphSpacing: { min: 0, max: 2, step: 0.05, unit: "em" },
  firstLineIndent: { min: 0, max: 3, step: 0.1, unit: "em" },
  columnCount: { min: 1, max: 3, step: 1, unit: "" },
} as const;

export type ContinuousKey = keyof typeof TYPOGRAPHY_RANGES;

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_FONT_FAMILY = "serif";
export const DEFAULT_THEME = "light";
export const DEFAULT_LINE_HEIGHT = 1.7;
export const DEFAULT_CONTENT_WIDTH = 42;
export const DEFAULT_PAGE_PADDING = 1.75;
export const DEFAULT_TEXT_ALIGN: TextAlignValue = "start";
export const DEFAULT_LETTER_SPACING = 0;
export const DEFAULT_PARAGRAPH_SPACING = 1;
export const DEFAULT_FIRST_LINE_INDENT = 0;
export const DEFAULT_COLUMN_COUNT = 2;
export const DEFAULT_OVERRIDE_FONT = false;
export const DEFAULT_OVERRIDE_LAYOUT = false;

const LINE_HEIGHT_ENUM: Record<string, number> = {
  compact: 1.4,
  normal: 1.7,
  relaxed: 2.0,
};

const PAGE_MARGIN_ENUM: Record<string, { contentWidth: number; pagePadding: number }> = {
  narrow: { contentWidth: 36, pagePadding: 1.25 },
  normal: { contentWidth: 42, pagePadding: 1.75 },
  wide: { contentWidth: 52, pagePadding: 2.5 },
};

export interface TypographyDefaults {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  contentWidth: number;
  pagePadding: number;
  textAlign: TextAlignValue;
  letterSpacing: number;
  paragraphSpacing: number;
  firstLineIndent: number;
  columnCount: number;
  overrideFont: boolean;
  overrideLayout: boolean;
}

export const DEFAULT_TYPOGRAPHY: TypographyDefaults = {
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  lineHeight: DEFAULT_LINE_HEIGHT,
  contentWidth: DEFAULT_CONTENT_WIDTH,
  pagePadding: DEFAULT_PAGE_PADDING,
  textAlign: DEFAULT_TEXT_ALIGN,
  letterSpacing: DEFAULT_LETTER_SPACING,
  paragraphSpacing: DEFAULT_PARAGRAPH_SPACING,
  firstLineIndent: DEFAULT_FIRST_LINE_INDENT,
  columnCount: DEFAULT_COLUMN_COUNT,
  overrideFont: DEFAULT_OVERRIDE_FONT,
  overrideLayout: DEFAULT_OVERRIDE_LAYOUT,
};

export interface ReaderStyleState extends TypographyDefaults {
  theme: string;
}

export function isTextAlign(value: string | undefined): value is TextAlignValue {
  return TEXT_ALIGNS.some((item) => item.value === value);
}

const MAX_FONT_FAMILY_CHARS = 128;

export function isGenericFontFamily(
  value: string,
): value is (typeof FONT_FAMILIES)[number]["value"] {
  return FONT_FAMILIES.some((item) => item.value === value);
}

export function isFontFamily(value: string | undefined): boolean {
  if (value == null) return false;
  if (isGenericFontFamily(value)) return true;
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > MAX_FONT_FAMILY_CHARS) return false;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || ch === ";" || ch === "{" || ch === "}") return false;
  }
  return true;
}

/** Quote a named family and append `, serif` so a missing face degrades in CSS. */
export function cssFontFamily(value: string): string {
  if (isGenericFontFamily(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}", serif`;
}

export function normalizeTextAlign(value?: string): TextAlignValue {
  return isTextAlign(value) ? value : DEFAULT_TEXT_ALIGN;
}

export function stepDecimals(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function clampSnap(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const snapped = Math.round((value - min) / step) * step + min;
  const clamped = Math.min(max, Math.max(min, snapped));
  return Number(clamped.toFixed(stepDecimals(step)));
}

export function formatTypographyValue(key: ContinuousKey, value: number): string {
  const spec = TYPOGRAPHY_RANGES[key];
  const text = value.toFixed(stepDecimals(spec.step));
  return spec.unit ? `${text}${spec.unit}` : text;
}

export function migrateLineHeight(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    if (value in LINE_HEIGHT_ENUM) return LINE_HEIGHT_ENUM[value];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function splitPageMargin(
  value: string | undefined,
): { contentWidth: number; pagePadding: number } | undefined {
  if (!value) return undefined;
  return PAGE_MARGIN_ENUM[value];
}

function normalizeContinuous(key: ContinuousKey, value: unknown): number {
  const spec = TYPOGRAPHY_RANGES[key];
  const resolved = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_TYPOGRAPHY[key];
  return clampSnap(resolved, spec.min, spec.max, spec.step);
}

export function normalizeSettings(
  settings?: ReadingSettings,
  preferences?: Partial<TypographyDefaults> & { theme?: string; pageMargin?: string },
): ReaderStyleState {
  const bookMargin = splitPageMargin(settings?.pageMargin);
  const prefMargin = splitPageMargin(preferences?.pageMargin);
  return {
    fontSize: normalizeContinuous("fontSize", settings?.fontSize ?? preferences?.fontSize),
    fontFamily: isFontFamily(settings?.fontFamily)
      ? settings!.fontFamily!
      : isFontFamily(preferences?.fontFamily)
        ? preferences!.fontFamily!
        : DEFAULT_FONT_FAMILY,
    theme: preferences?.theme ?? DEFAULT_THEME,
    lineHeight: normalizeContinuous(
      "lineHeight",
      migrateLineHeight(settings?.lineHeight) ?? migrateLineHeight(preferences?.lineHeight),
    ),
    contentWidth: normalizeContinuous(
      "contentWidth",
      settings?.contentWidth ?? bookMargin?.contentWidth ?? preferences?.contentWidth ?? prefMargin?.contentWidth,
    ),
    pagePadding: normalizeContinuous(
      "pagePadding",
      settings?.pagePadding ?? bookMargin?.pagePadding ?? preferences?.pagePadding ?? prefMargin?.pagePadding,
    ),
    textAlign: normalizeTextAlign(settings?.textAlign ?? preferences?.textAlign),
    letterSpacing: normalizeContinuous(
      "letterSpacing",
      settings?.letterSpacing ?? preferences?.letterSpacing,
    ),
    paragraphSpacing: normalizeContinuous(
      "paragraphSpacing",
      settings?.paragraphSpacing ?? preferences?.paragraphSpacing,
    ),
    firstLineIndent: normalizeContinuous(
      "firstLineIndent",
      settings?.firstLineIndent ?? preferences?.firstLineIndent,
    ),
    columnCount: normalizeContinuous(
      "columnCount",
      settings?.columnCount ?? preferences?.columnCount,
    ),
    overrideFont: settings?.overrideFont ?? preferences?.overrideFont ?? DEFAULT_OVERRIDE_FONT,
    overrideLayout:
      settings?.overrideLayout ?? preferences?.overrideLayout ?? DEFAULT_OVERRIDE_LAYOUT,
  };
}

type TypographyValue = number | string | boolean;

function materializeOverrides(
  overrides?: ReadingSettings,
): Partial<Record<TypographyKey, TypographyValue>> {
  if (!overrides) return {};
  const result: Partial<Record<TypographyKey, TypographyValue>> = {};
  if (overrides.fontSize != null) result.fontSize = overrides.fontSize;
  if (overrides.fontFamily) result.fontFamily = overrides.fontFamily;
  const lineHeight = migrateLineHeight(overrides.lineHeight);
  if (lineHeight != null) result.lineHeight = lineHeight;
  const split = splitPageMargin(overrides.pageMargin);
  if (overrides.contentWidth != null) result.contentWidth = overrides.contentWidth;
  else if (split) result.contentWidth = split.contentWidth;
  if (overrides.pagePadding != null) result.pagePadding = overrides.pagePadding;
  else if (split) result.pagePadding = split.pagePadding;
  if (overrides.textAlign) result.textAlign = overrides.textAlign;
  if (overrides.letterSpacing != null) result.letterSpacing = overrides.letterSpacing;
  if (overrides.paragraphSpacing != null) result.paragraphSpacing = overrides.paragraphSpacing;
  if (overrides.firstLineIndent != null) result.firstLineIndent = overrides.firstLineIndent;
  if (overrides.columnCount != null) result.columnCount = overrides.columnCount;
  if (overrides.overrideFont != null) result.overrideFont = overrides.overrideFont;
  if (overrides.overrideLayout != null) result.overrideLayout = overrides.overrideLayout;
  return result;
}

export function isTypographyOverridden(
  settings: ReadingSettings | undefined,
  key: TypographyKey,
): boolean {
  if (!settings) return false;
  if (key === "contentWidth" || key === "pagePadding") {
    return settings[key] != null || Boolean(settings.pageMargin);
  }
  return settings[key] != null;
}

/** Persistable per-book snapshot. Omit a typography key to restore that default. */
export function bookSettingsSnapshot(
  overrides: ReadingSettings | undefined,
  set?: Partial<Pick<ReaderStyleState, TypographyKey>>,
  omit?: TypographyKey,
): ReadingSettings {
  const next = { ...materializeOverrides(overrides), ...set };
  if (omit) delete next[omit];
  const snapshot: ReadingSettings = {};
  for (const key of TYPOGRAPHY_KEYS) {
    const value = next[key];
    if (value != null) {
      (snapshot as Record<string, TypographyValue>)[key] = value;
    }
  }
  return snapshot;
}

const PREVIEW_SELECTOR = ".litera-typography-preview";

/** Typography-only preview CSS scoped to `.litera-typography-preview`.
 *  Strips the THEME_CSS branch so no global html/body background is injected. */
export function generatePreviewCss(state: ReaderStyleState): string {
  return `${PREVIEW_SELECTOR} { font-family: ${cssFontFamily(state.fontFamily)}; font-size: ${state.fontSize}px; line-height: ${state.lineHeight}; letter-spacing: ${state.letterSpacing}em; max-width: ${state.contentWidth}em; margin-inline: auto; padding-inline: ${state.pagePadding}rem; text-align: ${state.textAlign}; }
${PREVIEW_SELECTOR} p { margin-block-end: ${state.paragraphSpacing}em; text-indent: ${state.firstLineIndent}em; }`;
}

const THEME_CSS: Record<string, string> = {
  light: "",
  dark: `html, body { background: #1a1a1a !important; color: #c8c8c8 !important; }
a { color: #6db4ff !important; }
img { filter: brightness(0.8) !important; }`,
};

/** Combine font + typography + theme into a single CSS string for `view.renderer.setStyles`. */
export function generateStylesCss(state: ReaderStyleState): string {
  let fontCss = `html, body { font-family: ${cssFontFamily(state.fontFamily)}; font-size: ${state.fontSize}px !important; line-height: ${state.lineHeight}; letter-spacing: ${state.letterSpacing}em; max-width: ${state.contentWidth}em; margin-inline: auto; padding-inline: ${state.pagePadding}rem; text-align: ${state.textAlign}; }
p { margin-block-end: ${state.paragraphSpacing}em !important; text-indent: ${state.firstLineIndent}em !important; }`;
  if (state.overrideFont) {
    fontCss += `\nhtml, body, p, div, span, li, blockquote, td, th, a, h1, h2, h3, h4, h5, h6 { font-family: ${cssFontFamily(state.fontFamily)} !important; }
code, kbd, pre, samp { font-family: monospace !important; }`;
  }
  if (state.overrideLayout) {
    fontCss += `\nhtml, body, p, div, li, blockquote { font-size: ${state.fontSize}px !important; line-height: ${state.lineHeight} !important; letter-spacing: ${state.letterSpacing}em !important; text-align: ${state.textAlign} !important; }`;
  }
  const themeCss = THEME_CSS[state.theme] ?? "";
  return themeCss ? `${fontCss}\n${themeCss}` : fontCss;
}

/**
 * Compact overlay for the footnote popup inner view. Append after
 * `generateStylesCss` so `!important` rules beat page padding, max-width,
 * first-line indent, and the theme page background.
 */
export function footnotePopupCss(): string {
  return `html, body { background: transparent !important; min-height: 0 !important; height: auto !important; max-width: none !important; margin-inline: 0 !important; padding: 0.75rem !important; }
p { text-indent: 0 !important; margin-block-end: 0.5em !important; }`;
}
