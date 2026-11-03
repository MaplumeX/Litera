import type { Sitting } from "@/lib/sitting-tracker";
import type { BookRecord } from "@/types/library";

/**
 * Reading stats, derived from Reading logs whenever they are shown. Nothing here
 * reads the clock or the disk: "today" and the data come in as arguments.
 */

/** A local date as `YYYY-MM-DD`, which also sorts by date. */
export type DateKey = string;

export interface BookLabel {
  title: string;
  author: string;
}

/** One device's Reading log, as the `get_reading_logs` command returns it. */
export interface ReadingLog {
  schemaVersion: number;
  deviceId: string;
  books: Record<string, BookLabel>;
  sittings: Sitting[];
}

/** The Book facts stats use; `BookRecord` provides them. */
export type StatsBook = Pick<BookRecord, "id" | "title" | "author" | "readingStatus"> &
  Partial<Pick<BookRecord, "lastFraction" | "statusUpdatedAt">>;

export type PeriodKind = "week" | "month" | "year";

/** Both ends included. */
export interface DateRange {
  start: DateKey;
  end: DateKey;
}

export interface PeriodSummary {
  seconds: number;
  daysRead: number;
  /** Over the days of the period so far, read or not. */
  dailyAverageSeconds: number;
  /** Against the same stretch of the previous period, as a fraction; null with nothing to compare. */
  change: number | null;
  finished: number;
}

export interface SeriesPoint {
  /** A date for a daily series, `YYYY-MM` for a monthly one. */
  key: string;
  seconds: number;
}

export interface BookTotal {
  bookId: string;
  title: string;
  author: string;
  seconds: number;
  /** The start of its latest Sitting in the range. */
  lastRead: string;
  /** Where the Book stands now; undefined once deleted. */
  fraction?: number;
  /** No longer in the Library: labelled from the log, and cannot be opened. */
  deleted: boolean;
}

const DAY_MS = 86_400_000;
const HEATMAP_WEEKS = 52;

function toUtcMs(key: DateKey): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

function fromUtcMs(ms: number): DateKey {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(key: DateKey, days: number): DateKey {
  return fromUtcMs(toUtcMs(key) + days * DAY_MS);
}

function daysBetween(start: DateKey, end: DateKey): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / DAY_MS);
}

function endOfMonth(year: number, monthIndex: number): DateKey {
  return fromUtcMs(Date.UTC(year, monthIndex + 1, 0));
}

function mondayOf(key: DateKey): DateKey {
  const weekday = new Date(toUtcMs(key)).getUTCDay();
  return addDays(key, -((weekday + 6) % 7));
}

function inRange(key: DateKey, range: DateRange): boolean {
  return key >= range.start && key <= range.end;
}

/** The device's local date of an instant. */
export function localDateKey(ms: number): DateKey {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A Sitting's date as lived: its own offset, not the viewing device's. */
export function sittingDate(sitting: Sitting): DateKey {
  return sitting.start.slice(0, 10);
}

/** Every usable Sitting of all devices. Another device's bad entry is skipped. */
export function allSittings(logs: ReadingLog[]): Sitting[] {
  return logs.flatMap((log) =>
    (log.sittings ?? []).filter(
      (sitting) =>
        /^\d{4}-\d{2}-\d{2}T/.test(sitting.start) &&
        !Number.isNaN(Date.parse(sitting.start)) &&
        Number.isFinite(sitting.seconds) &&
        sitting.seconds > 0,
    ),
  );
}

/** Weeks start on Monday. */
export function periodRange(kind: PeriodKind, anchor: DateKey): DateRange {
  const year = Number(anchor.slice(0, 4));
  const monthIndex = Number(anchor.slice(5, 7)) - 1;
  switch (kind) {
    case "week": {
      const start = mondayOf(anchor);
      return { start, end: addDays(start, 6) };
    }
    case "month":
      return { start: `${anchor.slice(0, 7)}-01`, end: endOfMonth(year, monthIndex) };
    case "year":
      return { start: `${anchor.slice(0, 4)}-01-01`, end: `${anchor.slice(0, 4)}-12-31` };
  }
}

/** The period `steps` before (negative) or after (positive) the one holding `anchor`. */
export function shiftPeriod(kind: PeriodKind, anchor: DateKey, steps: number): DateKey {
  const { start } = periodRange(kind, anchor);
  if (kind === "week") return addDays(start, 7 * steps);
  const year = Number(start.slice(0, 4));
  if (kind === "year") return `${String(year + steps).padStart(4, "0")}-01-01`;
  return fromUtcMs(Date.UTC(year, Number(start.slice(5, 7)) - 1 + steps, 1));
}

function totalSeconds(sittings: Sitting[], range: DateRange): number {
  return sittings.reduce(
    (sum, sitting) => (inRange(sittingDate(sitting), range) ? sum + sitting.seconds : sum),
    0,
  );
}

/** A Book's finish date; undefined for a backfilled status, which has no timestamp. */
function finishedDate(book: StatsBook): DateKey | undefined {
  if (book.readingStatus !== "finished" || !book.statusUpdatedAt) return undefined;
  const ms = Date.parse(book.statusUpdatedAt);
  return Number.isNaN(ms) ? undefined : localDateKey(ms);
}

function sinceStart(range: DateRange, today: DateKey): DateRange | null {
  if (today < range.start) return null;
  return { start: range.start, end: today < range.end ? today : range.end };
}

export function summarizePeriod(
  sittings: Sitting[],
  books: StatsBook[],
  kind: PeriodKind,
  anchor: DateKey,
  today: DateKey,
): PeriodSummary {
  const range = periodRange(kind, anchor);
  const inPeriod = sittings.filter((sitting) => inRange(sittingDate(sitting), range));
  const seconds = totalSeconds(inPeriod, range);
  const elapsed = sinceStart(range, today);
  const elapsedDays = elapsed ? daysBetween(elapsed.start, elapsed.end) + 1 : 0;
  return {
    seconds,
    daysRead: new Set(inPeriod.map(sittingDate)).size,
    dailyAverageSeconds: elapsedDays > 0 ? Math.round(seconds / elapsedDays) : 0,
    change: changeFromPrevious(sittings, kind, range, elapsedDays),
    finished: books.filter((book) => {
      const date = finishedDate(book);
      return date !== undefined && inRange(date, range);
    }).length,
  };
}

/**
 * Compares like with like: three days into a month against the first three
 * days of the month before, not all of it.
 */
function changeFromPrevious(
  sittings: Sitting[],
  kind: PeriodKind,
  range: DateRange,
  elapsedDays: number,
): number | null {
  if (elapsedDays === 0) return null;
  const previous = periodRange(kind, shiftPeriod(kind, range.start, -1));
  const stretchEnd = addDays(previous.start, elapsedDays - 1);
  const before = totalSeconds(sittings, {
    start: previous.start,
    end: stretchEnd < previous.end ? stretchEnd : previous.end,
  });
  if (before === 0) return null;
  const now = totalSeconds(sittings, {
    start: range.start,
    end: addDays(range.start, elapsedDays - 1),
  });
  return (now - before) / before;
}

export function allTimeSummary(
  sittings: Sitting[],
  books: StatsBook[],
): { seconds: number; daysRead: number; finished: number } {
  return {
    seconds: sittings.reduce((sum, sitting) => sum + sitting.seconds, 0),
    daysRead: new Set(sittings.map(sittingDate)).size,
    finished: books.filter((book) => book.readingStatus === "finished").length,
  };
}

/** Days read in a row up to today; an unread today does not break it yet. */
export function currentStreak(sittings: Sitting[], today: DateKey): number {
  const days = new Set(sittings.map(sittingDate));
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return streak;
}

function secondsByDate(sittings: Sitting[]): Map<DateKey, number> {
  const totals = new Map<DateKey, number>();
  for (const sitting of sittings) {
    const date = sittingDate(sitting);
    totals.set(date, (totals.get(date) ?? 0) + sitting.seconds);
  }
  return totals;
}

/** Every day of the range, unread ones at zero. */
export function dailySeries(sittings: Sitting[], range: DateRange): SeriesPoint[] {
  const totals = secondsByDate(sittings);
  const points: SeriesPoint[] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    points.push({ key: day, seconds: totals.get(day) ?? 0 });
  }
  return points;
}

/** The twelve months of `year`, unread ones at zero. */
export function monthlySeries(sittings: Sitting[], year: string): SeriesPoint[] {
  const points = Array.from({ length: 12 }, (_, index) => ({
    key: `${year}-${String(index + 1).padStart(2, "0")}`,
    seconds: 0,
  }));
  for (const sitting of sittings) {
    const date = sittingDate(sitting);
    if (date.slice(0, 4) === year) points[Number(date.slice(5, 7)) - 1].seconds += sitting.seconds;
  }
  return points;
}

/** The heatmap's days: whole weeks from a Monday, ending today, so columns line up. */
export function heatmapDays(sittings: Sitting[], today: DateKey): SeriesPoint[] {
  const start = addDays(mondayOf(today), -7 * (HEATMAP_WEEKS - 1));
  return dailySeries(sittings, { start, end: today });
}

/** The Books read in a range, most time first. */
export function bookTotals(
  logs: ReadingLog[],
  books: StatsBook[],
  range: DateRange,
): BookTotal[] {
  const library = new Map(books.map((book) => [book.id, book]));
  // Later logs win; any device's label will do once a Book is deleted.
  const labels = new Map<string, BookLabel>();
  for (const log of logs) {
    for (const [bookId, label] of Object.entries(log.books ?? {})) labels.set(bookId, label);
  }
  const totals = new Map<string, { seconds: number; lastRead: string; lastMs: number }>();
  for (const sitting of allSittings(logs)) {
    if (!inRange(sittingDate(sitting), range)) continue;
    const ms = Date.parse(sitting.start);
    const total = totals.get(sitting.bookId);
    if (!total) {
      totals.set(sitting.bookId, { seconds: sitting.seconds, lastRead: sitting.start, lastMs: ms });
      continue;
    }
    total.seconds += sitting.seconds;
    if (ms > total.lastMs) {
      total.lastMs = ms;
      total.lastRead = sitting.start;
    }
  }
  return [...totals]
    .map(([bookId, total]): BookTotal => {
      const book = library.get(bookId);
      const label = book ?? labels.get(bookId);
      return {
        bookId,
        title: label?.title ?? "",
        author: label?.author ?? "",
        seconds: total.seconds,
        lastRead: total.lastRead,
        fraction: book?.lastFraction,
        deleted: !book,
      };
    })
    .sort(
      (a, b) =>
        b.seconds - a.seconds || Date.parse(b.lastRead) - Date.parse(a.lastRead) || a.bookId.localeCompare(b.bookId),
    );
}
