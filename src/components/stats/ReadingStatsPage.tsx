import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { BookCoverImage } from "@/components/BookCard";
import { ReadingHeatmap } from "@/components/stats/ReadingHeatmap";
import { ReadingTimeBars } from "@/components/stats/ReadingTimeBars";
import { Button } from "@/components/ui/button";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  allSittings,
  allTimeSummary,
  bookTotals,
  currentStreak,
  dailySeries,
  heatmapDays,
  localDateKey,
  monthlySeries,
  periodRange,
  shiftPeriod,
  summarizePeriod,
  type BookTotal,
  type DateKey,
  type PeriodKind,
  type ReadingLog,
} from "@/lib/reading-stats";
import { useReadingStatsEnabled } from "@/lib/reading-stats-prefs";
import {
  formatChange,
  formatDay,
  formatDuration,
  formatFullDay,
  formatPeriod,
} from "@/lib/reading-stats-format";
import { cn } from "@/lib/utils";
import type { BookRecord } from "@/types/library";

const PERIODS: { kind: PeriodKind; labelKey: MessageKey; previousKey: MessageKey }[] = [
  { kind: "week", labelKey: "stats.period.week", previousKey: "stats.change.week" },
  { kind: "month", labelKey: "stats.period.month", previousKey: "stats.change.month" },
  { kind: "year", labelKey: "stats.period.year", previousKey: "stats.change.year" },
];

function StatTile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="mt-0.5 min-h-4 text-xs tabular-nums text-muted-foreground">{note}</dd>
    </div>
  );
}

function BookRow({
  total,
  book,
  coverRev,
  opening,
  onOpen,
}: {
  total: BookTotal;
  book?: BookRecord;
  coverRev?: number;
  opening: boolean;
  onOpen: (bookId: string) => void;
}) {
  const { t } = useT();
  const percent = total.fraction === undefined ? null : Math.floor(total.fraction * 100);
  const content = (
    <>
      <div className="h-12 w-8 shrink-0 overflow-hidden rounded-cover bg-muted">
        {book && <BookCoverImage book={book} coverRev={coverRev} small />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{total.title || t("stats.books.untitled")}</p>
        <p className="truncate text-xs text-muted-foreground">
          {total.deleted ? t("stats.books.deleted") : total.author}
        </p>
      </div>
      {percent !== null && (
        <div className="hidden w-24 shrink-0 items-center gap-2 sm:flex">
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-foreground/50" style={{ width: `${percent}%` }} />
          </div>
          <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{percent}%</span>
        </div>
      )}
      <div className="w-20 shrink-0 text-right">
        <p className="text-sm tabular-nums">{formatDuration(total.seconds)}</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatDay(total.lastRead.slice(0, 10))}
        </p>
      </div>
    </>
  );
  const rowClass = "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left";
  if (total.deleted) return <div className={rowClass}>{content}</div>;
  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => onOpen(total.bookId)}
      className={cn(
        rowClass,
        "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 motion-reduce:transition-none",
      )}
    >
      {content}
    </button>
  );
}

interface ReadingStatsPageProps {
  books: BookRecord[];
  coverRev?: Record<string, number | undefined>;
  openingBookId?: string | null;
  onOpenBook: (bookId: string) => void | Promise<void>;
  /** The phone's app bar already carries the title. */
  showTitle?: boolean;
}

/** Everything here is derived from the Reading logs each time they load. */
export function ReadingStatsPage({
  books,
  coverRev = {},
  openingBookId = null,
  onOpenBook,
  showTitle = true,
}: ReadingStatsPageProps) {
  const { t } = useT();
  const [recording] = useReadingStatsEnabled();
  const [logs, setLogs] = useState<ReadingLog[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [today] = useState<DateKey>(() => localDateKey(Date.now()));
  const [anchor, setAnchor] = useState<DateKey>(today);
  const [pickedDay, setPickedDay] = useState<DateKey | null>(null);

  const load = useCallback(() => {
    invoke<ReadingLog[]>("get_reading_logs")
      .then((next) => {
        setLogs(next ?? []);
        setFailed(false);
      })
      .catch((error: unknown) => {
        console.error("Failed to read reading logs:", error);
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    load();
    window.addEventListener("litera:reading-logs-synced", load);
    return () => window.removeEventListener("litera:reading-logs-synced", load);
  }, [load]);

  const sittings = useMemo(() => allSittings(logs ?? []), [logs]);
  const range = useMemo(() => periodRange(kind, anchor), [kind, anchor]);
  const summary = useMemo(
    () => summarizePeriod(sittings, books, kind, anchor, today),
    [sittings, books, kind, anchor, today],
  );
  const allTime = useMemo(() => allTimeSummary(sittings, books), [sittings, books]);
  const streak = useMemo(() => currentStreak(sittings, today), [sittings, today]);
  const heatmap = useMemo(() => heatmapDays(sittings, today), [sittings, today]);
  const series = useMemo(
    () =>
      kind === "year"
        ? monthlySeries(sittings, anchor.slice(0, 4))
        : dailySeries(sittings, range),
    [sittings, kind, anchor, range],
  );
  const ranking = useMemo(
    () =>
      bookTotals(logs ?? [], books, pickedDay ? { start: pickedDay, end: pickedDay } : range),
    [logs, books, pickedDay, range],
  );
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books]);

  const period = PERIODS.find((item) => item.kind === kind)!;
  const atLatest = periodRange(kind, shiftPeriod(kind, anchor, 1)).start > today;

  const changePeriod = (next: PeriodKind) => {
    setKind(next);
    setAnchor(today);
    setPickedDay(null);
  };
  const stepPeriod = (steps: number) => {
    setAnchor(shiftPeriod(kind, anchor, steps));
    setPickedDay(null);
  };

  if (failed && logs === null) {
    return (
      <p role="alert" className="pt-8 text-center text-sm text-destructive">
        {t("stats.loadFailed")}
      </p>
    );
  }
  if (logs === null) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pt-2">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {showTitle && <h2 className="text-lg font-semibold tracking-tight">{t("stats.title")}</h2>}
        <div className={cn("flex items-center gap-2", !showTitle && "w-full justify-between")}>
          <div role="group" aria-label={t("stats.period.label")} className="flex rounded-md bg-muted p-0.5">
            {PERIODS.map((item) => (
              <button
                key={item.kind}
                type="button"
                aria-pressed={kind === item.kind}
                onClick={() => changePeriod(item.kind)}
                className={cn(
                  "rounded-[5px] px-2.5 py-0.5 text-xs transition-colors pointer-coarse:px-3 pointer-coarse:py-1.5 pointer-coarse:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                  kind === item.kind
                    ? "bg-background font-medium shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("stats.period.previous")}
              onClick={() => stepPeriod(-1)}
            >
              <ChevronLeft />
            </Button>
            <span aria-live="polite" className="min-w-24 text-center text-sm tabular-nums">
              {formatPeriod(kind, range)}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("stats.period.next")}
              disabled={atLatest}
              onClick={() => stepPeriod(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </header>

      {sittings.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
          {t(recording ? "stats.empty.recording" : "stats.empty.off")}
        </p>
      ) : (
        !recording && <p className="text-xs text-muted-foreground">{t("stats.recordingOff")}</p>
      )}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t("stats.tile.time")}
          value={formatDuration(summary.seconds)}
          note={
            summary.change === null
              ? undefined
              : t(period.previousKey, { change: formatChange(summary.change) })
          }
        />
        <StatTile
          label={t("stats.tile.days")}
          value={t("stats.tile.daysValue", { days: summary.daysRead })}
          note={streak > 0 ? t("stats.tile.streak", { days: streak }) : undefined}
        />
        <StatTile label={t("stats.tile.average")} value={formatDuration(summary.dailyAverageSeconds)} />
        <StatTile
          label={t("stats.tile.finished")}
          value={t("stats.tile.finishedValue", { count: summary.finished })}
          note={t("stats.tile.finishedAll", { count: allTime.finished })}
        />
      </dl>

      <ReadingHeatmap days={heatmap} selected={pickedDay} onSelect={setPickedDay} />
      <ReadingTimeBars kind={kind} points={series} />

      <section aria-labelledby="stats-books-title">
        <div className="mb-1 flex min-h-7 items-center justify-between gap-4">
          <h3 id="stats-books-title" className="text-sm font-medium">
            {pickedDay ? formatFullDay(pickedDay) : t("stats.books.title")}
          </h3>
          {pickedDay && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPickedDay(null)}>
              <X className="size-3.5" />
              {t("stats.books.clearDay")}
            </Button>
          )}
        </div>
        {ranking.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t(pickedDay ? "stats.books.noneDay" : "stats.books.none")}
          </p>
        ) : (
          <div className="-mx-2 flex flex-col">
            {ranking.map((total) => (
              <BookRow
                key={total.bookId}
                total={total}
                book={booksById.get(total.bookId)}
                coverRev={coverRev[total.bookId]}
                opening={openingBookId === total.bookId}
                onOpen={(bookId) => void onOpenBook(bookId)}
              />
            ))}
          </div>
        )}
      </section>

      {allTime.seconds > 0 && (
        <p className="pb-2 text-center text-xs tabular-nums text-muted-foreground">
          {t("stats.allTime", {
            time: formatDuration(allTime.seconds),
            days: allTime.daysRead,
          })}
        </p>
      )}
    </div>
  );
}
