import { cssFontFamily, isFontFamily, isGenericFontFamily } from "@/lib/reader-styles";

export const UI_FONT_SIZE_KEY = "litera.uiFontSize";
export const UI_FONT_FAMILY_KEY = "litera.uiFontFamily";
export const DEFAULT_UI_FONT_SIZE = 16;
export const DEFAULT_UI_FONT_FAMILY = "Geist Variable";
export const UI_FONT_SIZE_RANGE = { min: 12, max: 20, step: 1 };

const CHROME_FALLBACKS = [
  "PingFang SC",
  "Microsoft YaHei",
  "Noto Sans SC",
  "ui-sans-serif",
  "system-ui",
  "sans-serif",
] as const;

const DEFAULT_CHROME_STACK =
  '"Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif';

export function parseUiFontSize(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_UI_FONT_SIZE;
  return Math.round(
    Math.min(UI_FONT_SIZE_RANGE.max, Math.max(UI_FONT_SIZE_RANGE.min, n)),
  );
}

export function parseUiFontFamily(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_UI_FONT_FAMILY;
  const trimmed = value.trim();
  if (!isFontFamily(trimmed)) return DEFAULT_UI_FONT_FAMILY;
  return trimmed;
}

export function loadUiFontSize(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_UI_FONT_SIZE;
    return parseUiFontSize(localStorage.getItem(UI_FONT_SIZE_KEY));
  } catch {
    return DEFAULT_UI_FONT_SIZE;
  }
}

export function loadUiFontFamily(): string {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_UI_FONT_FAMILY;
    return parseUiFontFamily(localStorage.getItem(UI_FONT_FAMILY_KEY));
  } catch {
    return DEFAULT_UI_FONT_FAMILY;
  }
}

export function saveUiFontSize(px: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(UI_FONT_SIZE_KEY, String(parseUiFontSize(px)));
  } catch {
    // private mode / quota
  }
}

export function saveUiFontFamily(name: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(UI_FONT_FAMILY_KEY, parseUiFontFamily(name));
  } catch {
    // private mode / quota
  }
}

function quoteFallback(name: string): string {
  if (name === "ui-sans-serif" || name === "system-ui" || isGenericFontFamily(name)) {
    return name;
  }
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function chromeFontStack(family: string): string {
  if (family === DEFAULT_UI_FONT_FAMILY) return DEFAULT_CHROME_STACK;
  const head = isGenericFontFamily(family)
    ? family
    : cssFontFamily(family).replace(/, serif$/, "");
  const rest = CHROME_FALLBACKS.filter((name) => name !== family).map(quoteFallback);
  return [head, ...rest].join(", ");
}

export function applyUiChrome(size: number, family: string): void {
  if (typeof document === "undefined") return;
  const px = parseUiFontSize(size);
  const fam = parseUiFontFamily(family);
  document.documentElement.style.fontSize = `${px}px`;
  document.documentElement.style.setProperty("--font-sans", chromeFontStack(fam));
}
