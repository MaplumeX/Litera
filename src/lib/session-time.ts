import type { AppLocale } from "@/lib/i18n";

export type SessionTimeGroup = "today" | "yesterday" | "week" | "earlier";

export const SESSION_TIME_GROUPS: readonly SessionTimeGroup[] = [
  "today",
  "yesterday",
  "week",
  "earlier",
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
}

/**
 * The heading a Session is listed under by its last-updated time: today,
 * yesterday, the rest of the last 7 days, or earlier. Days are calendar days
 * in local time. Unparseable input lands in "earlier".
 */
export function sessionTimeGroup(iso: string, now = new Date()): SessionTimeGroup {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "earlier";
  const days = daysAgo(date, now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "earlier";
}

/**
 * A Session's last-updated time as shown beside its title, under the heading
 * from `sessionTimeGroup`: "21:14" within today and yesterday (the heading
 * names the day), else "Oct 12", then "Oct 12, 2025" for past years.
 * Unparseable input yields "".
 */
export function formatSessionTime(iso: string, locale: AppLocale, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (daysAgo(date, now) <= 1) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
