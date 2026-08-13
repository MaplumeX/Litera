import type { ReadingSettings } from "@/types/library";

export const FONT_SIZES = [14, 16, 18, 20] as const;
export const FONT_SIZE_LABELS = ["S", "M", "L", "XL"] as const;
export const FONT_FAMILIES = [
  { value: "serif", label: "衬线", css: "serif" },
  { value: "sans-serif", label: "无衬线", css: "sans-serif" },
  { value: "monospace", label: "等宽", css: "monospace" },
] as const;
export const THEMES = ["light", "dark", "sepia"] as const;

export const LINE_HEIGHTS = [
  { value: "compact", label: "密", css: "1.4" },
  { value: "normal", label: "中", css: "1.7" },
  { value: "relaxed", label: "疏", css: "2.0" },
] as const;
export const PAGE_MARGINS = [
  { value: "narrow", label: "窄", maxWidth: "36em", padding: "1.25rem" },
  { value: "normal", label: "中", maxWidth: "42em", padding: "1.75rem" },
  { value: "wide", label: "宽", maxWidth: "52em", padding: "2.5rem" },
] as const;
export const TEXT_ALIGNS = [
  { value: "start", label: "左齐" },
  { value: "justify", label: "两端" },
] as const;

export type LineHeightValue = (typeof LINE_HEIGHTS)[number]["value"];
export type PageMarginValue = (typeof PAGE_MARGINS)[number]["value"];
export type TextAlignValue = (typeof TEXT_ALIGNS)[number]["value"];
export type TypographyKey = "lineHeight" | "pageMargin" | "textAlign";

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_FONT_FAMILY = "serif";
export const DEFAULT_THEME = "light";
export const DEFAULT_LINE_HEIGHT: LineHeightValue = "normal";
export const DEFAULT_PAGE_MARGIN: PageMarginValue = "normal";
export const DEFAULT_TEXT_ALIGN: TextAlignValue = "start";

export interface TypographyDefaults {
  lineHeight: LineHeightValue;
  pageMargin: PageMarginValue;
  textAlign: TextAlignValue;
}

export const DEFAULT_TYPOGRAPHY: TypographyDefaults = {
  lineHeight: DEFAULT_LINE_HEIGHT,
  pageMargin: DEFAULT_PAGE_MARGIN,
  textAlign: DEFAULT_TEXT_ALIGN,
};

export interface ReaderStyleState {
  fontSize: number;
  fontFamily: string;
  theme: string;
  lineHeight: LineHeightValue;
  pageMargin: PageMarginValue;
  textAlign: TextAlignValue;
}

export function isLineHeight(value: string | undefined): value is LineHeightValue {
  return LINE_HEIGHTS.some((item) => item.value === value);
}

export function isPageMargin(value: string | undefined): value is PageMarginValue {
  return PAGE_MARGINS.some((item) => item.value === value);
}

export function isTextAlign(value: string | undefined): value is TextAlignValue {
  return TEXT_ALIGNS.some((item) => item.value === value);
}

export function normalizeLineHeight(value?: string): LineHeightValue {
  return isLineHeight(value) ? value : DEFAULT_LINE_HEIGHT;
}

export function normalizePageMargin(value?: string): PageMarginValue {
  return isPageMargin(value) ? value : DEFAULT_PAGE_MARGIN;
}

export function normalizeTextAlign(value?: string): TextAlignValue {
  return isTextAlign(value) ? value : DEFAULT_TEXT_ALIGN;
}

export function normalizeSettings(
  settings?: ReadingSettings,
  preferences?: Partial<TypographyDefaults> & { theme?: string },
): ReaderStyleState {
  return {
    fontSize: settings?.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: settings?.fontFamily ?? DEFAULT_FONT_FAMILY,
    theme: preferences?.theme ?? DEFAULT_THEME,
    lineHeight: normalizeLineHeight(settings?.lineHeight ?? preferences?.lineHeight),
    pageMargin: normalizePageMargin(settings?.pageMargin ?? preferences?.pageMargin),
    textAlign: normalizeTextAlign(settings?.textAlign ?? preferences?.textAlign),
  };
}

/** Persistable per-book snapshot. Omit a typography key to restore that default. */
export function bookSettingsSnapshot(
  style: Pick<ReaderStyleState, "fontSize" | "fontFamily">,
  overrides: ReadingSettings | undefined,
  omit?: TypographyKey,
): ReadingSettings {
  const snapshot: ReadingSettings = {
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
  };
  const keys: TypographyKey[] = ["lineHeight", "pageMargin", "textAlign"];
  for (const key of keys) {
    if (key === omit) continue;
    const value = overrides?.[key];
    if (value) snapshot[key] = value;
  }
  return snapshot;
}

const THEME_CSS: Record<string, string> = {
  light: "",
  dark: `html, body { background: #1a1a1a !important; color: #e0e0e0 !important; }
a { color: #6db4ff !important; }
img { filter: brightness(0.8) !important; }`,
  sepia: `html, body { background: #f4edd8 !important; color: #5b4636 !important; }
a { color: #8a5a2b !important; }`,
};

function lineHeightCss(value: LineHeightValue): string {
  return LINE_HEIGHTS.find((item) => item.value === value)?.css ?? "1.7";
}

function pageMarginPreset(value: PageMarginValue) {
  return PAGE_MARGINS.find((item) => item.value === value) ?? PAGE_MARGINS[1];
}

/** Combine font + typography + theme into a single CSS string for `view.renderer.setStyles`. */
export function generateStylesCss(state: ReaderStyleState): string {
  const margin = pageMarginPreset(state.pageMargin);
  const fontCss = `html, body { font-family: ${state.fontFamily}; font-size: ${state.fontSize}px !important; line-height: ${lineHeightCss(state.lineHeight)}; max-width: ${margin.maxWidth}; margin-inline: auto; padding-inline: ${margin.padding}; text-align: ${state.textAlign}; }`;
  const themeCss = THEME_CSS[state.theme] ?? "";
  return themeCss ? `${fontCss}\n${themeCss}` : fontCss;
}
