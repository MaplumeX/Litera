import { t, type AppLocale } from "@/lib/i18n";

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * A Session's last-updated time as the rail shows it, coarser the older it
 * is: "Today 21:14", "Yesterday", "Oct 12", then "Oct 12, 2025" for past
 * years. Days are calendar days in local time. Unparseable input yields "".
 */
export function formatSessionTime(iso: string, locale: AppLocale, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) {
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
    return t("chat.sessionTimeToday", { time });
  }
  if (days === 1) return t("chat.sessionTimeYesterday");
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
