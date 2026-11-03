import { useEffect, useState } from "react";
import { Tip } from "@/components/ui/tooltip";
import {
  formatDay,
  formatDuration,
  formatMonth,
  formatWeekday,
} from "@/lib/reading-stats-format";
import { useT } from "@/lib/i18n";
import type { PeriodKind, SeriesPoint } from "@/lib/reading-stats";

const SCALE_MINUTES = [15, 30, 60, 120, 180, 240, 360, 480, 720, 1200, 2400, 4800, 9600, 19200];

/** The next round figure at or above the tallest bar, for the one gridline. */
function scaleTop(maxSeconds: number): number {
  const minutes = maxSeconds / 60;
  const top = SCALE_MINUTES.find((value) => value >= minutes);
  return (top ?? Math.ceil(minutes / 60) * 60) * 60;
}

function axisLabel(kind: PeriodKind, point: SeriesPoint, index: number): string | null {
  if (kind === "year") return formatMonth(point.key);
  if (kind === "week") return formatWeekday(point.key);
  // Month: every seventh day, starting on the 1st.
  return index % 7 === 0 ? String(index + 1) : null;
}

interface ReadingTimeBarsProps {
  kind: PeriodKind;
  points: SeriesPoint[];
}

export function ReadingTimeBars({ kind, points }: ReadingTimeBarsProps) {
  const { t } = useT();
  const max = points.reduce((most, point) => Math.max(most, point.seconds), 0);
  const top = max > 0 ? scaleTop(max) : 0;
  // A tooltip needs a pointer; a tap names the bar in the header instead.
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => setTapped(null), [points]);
  const labelOf = (point: SeriesPoint) =>
    `${kind === "year" ? formatMonth(point.key) : formatDay(point.key)} · ${formatDuration(point.seconds)}`;
  const tappedPoint = points.find((point) => point.key === tapped);
  return (
    <section aria-labelledby="stats-bars-title">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h3 id="stats-bars-title" className="text-sm font-medium">
          {t("stats.bars.title")}
        </h3>
        {top > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {tappedPoint ? labelOf(tappedPoint) : t("stats.bars.scale", { value: formatDuration(top) })}
          </span>
        )}
      </div>
      <div className="flex h-32 items-end border-t border-b border-border/70" style={{ gap: 2 }}>
        {points.map((point) => {
          const label = labelOf(point);
          return (
            <Tip key={point.key} label={label} side="top">
              <div
                tabIndex={point.seconds > 0 ? 0 : undefined}
                role="img"
                aria-label={label}
                onClick={() => setTapped(point.seconds > 0 ? point.key : null)}
                className="group flex h-full min-w-0 flex-1 items-end justify-center rounded-t-[4px] hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                {point.seconds > 0 && (
                  <div
                    className="w-full max-w-6 rounded-t-[4px] bg-[var(--stats-mark)] transition-opacity group-hover:opacity-80 motion-reduce:transition-none"
                    style={{ height: `${Math.max((point.seconds / top) * 100, 1.5)}%` }}
                  />
                )}
              </div>
            </Tip>
          );
        })}
      </div>
      <div className="mt-1 flex text-xs text-muted-foreground" style={{ gap: 2 }} aria-hidden>
        {points.map((point, index) => (
          <div key={point.key} className="min-w-0 flex-1 whitespace-nowrap text-center">
            {axisLabel(kind, point, index)}
          </div>
        ))}
      </div>
    </section>
  );
}
