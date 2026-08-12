import type { ReadingSettings } from "@/types/library";

export const FONT_SIZES = [14, 16, 18, 20] as const;
export const FONT_SIZE_LABELS = ["S", "M", "L", "XL"] as const;
export const FONT_FAMILIES = [
  { value: "serif", label: "衬线", css: "serif" },
  { value: "sans-serif", label: "无衬线", css: "sans-serif" },
  { value: "monospace", label: "等宽", css: "monospace" },
] as const;
export const THEMES = ["light", "dark", "sepia"] as const;

export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_FONT_FAMILY = "serif";
export const DEFAULT_THEME = "light";

export interface ReaderStyleState {
  fontSize: number;
  fontFamily: string;
  theme: string;
}

export function normalizeSettings(
  settings?: ReadingSettings,
): ReaderStyleState {
  return {
    fontSize: settings?.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: settings?.fontFamily ?? DEFAULT_FONT_FAMILY,
    theme: settings?.theme ?? DEFAULT_THEME,
  };
}

const THEME_CSS: Record<string, string> = {
  light: "",
  dark: `html, body { background: #1a1a1a !important; color: #e0e0e0 !important; }
a { color: #6db4ff !important; }
img { filter: brightness(0.8) !important; }`,
  sepia: `html, body { background: #f4edd8 !important; color: #5b4636 !important; }
a { color: #8a5a2b !important; }`,
};

/** Combine font + theme into a single CSS string for `view.renderer.setStyles`. */
export function generateStylesCss(state: ReaderStyleState): string {
  const fontCss = `html, body { font-family: ${state.fontFamily}; font-size: ${state.fontSize}px !important; }`;
  const themeCss = THEME_CSS[state.theme] ?? "";
  return themeCss ? `${fontCss}\n${themeCss}` : fontCss;
}