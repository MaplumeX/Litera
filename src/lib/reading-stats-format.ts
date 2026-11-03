import { getLocale, t } from "@/lib/i18n";
import type { DateKey, DateRange, PeriodKind } from "@/lib/reading-stats";

function utc(key: string): Date {
  const [year, month = 1, day = 1] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" });
}

/** "18h 24m", "35m", "<1m". Minutes round down; a Book read at all shows something. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return t("stats.duration.minutes", { minutes: 0 });
  if (seconds < 60) return t("stats.duration.underMinute");
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return t("stats.duration.minutes", { minutes });
  if (minutes % 60 === 0) return t("stats.duration.hours", { hours });
  return t("stats.duration.hoursMinutes", { hours, minutes: minutes % 60 });
}

/** "+12%", "-30%"; no change shows "0%". */
export function formatChange(change: number): string {
  const percent = Math.round(change * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

export function formatDay(key: DateKey): string {
  return dateFormat({ month: "short", day: "numeric" }).format(utc(key));
}

export function formatFullDay(key: DateKey): string {
  return dateFormat({ year: "numeric", month: "short", day: "numeric", weekday: "short" }).format(
    utc(key),
  );
}

export function formatMonth(key: string): string {
  return dateFormat({ month: "short" }).format(utc(key));
}

export function formatWeekday(key: DateKey): string {
  return dateFormat({ weekday: "narrow" }).format(utc(key));
}

export function formatPeriod(kind: PeriodKind, range: DateRange): string {
  if (kind === "year") return dateFormat({ year: "numeric" }).format(utc(range.start));
  if (kind === "month") {
    return dateFormat({ year: "numeric", month: "long" }).format(utc(range.start));
  }
  return `${formatDay(range.start)} – ${formatDay(range.end)}`;
}
