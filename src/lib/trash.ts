import type { AppLocale } from "@/lib/i18n";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Human-readable byte size for the Trash list, e.g. "512 B" or "1.4 GB".
 * Non-finite or negative input clamps to 0 rather than printing "NaN".
 */
export function formatByteSize(bytes: number, locale: AppLocale): string {
  let value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatter = new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    maximumFractionDigits: unit === 0 ? 0 : 1,
    useGrouping: false,
  });
  return `${formatter.format(value)} ${BYTE_UNITS[unit]}`;
}
