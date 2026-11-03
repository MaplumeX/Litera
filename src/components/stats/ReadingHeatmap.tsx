import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { formatDuration, formatFullDay, formatMonth } from "@/lib/reading-stats-format";
import { useT } from "@/lib/i18n";
import type { DateKey, SeriesPoint } from "@/lib/reading-stats";
import { cn } from "@/lib/utils";

/** Fixed minutes, so a day looks the same whatever else was read that year. */
const LEVEL_MINUTES = [15, 30, 60];
const LEVEL_MIX = [32, 56, 78, 100];
const CELL_PX = 13;
const GAP_PX = 3;

function levelOf(seconds: number): number {
  if (seconds <= 0) return -1;
  const minutes = seconds / 60;
  const above = LEVEL_MINUTES.findIndex((limit) => minutes < limit);
  return above === -1 ? LEVEL_MINUTES.length : above;
}

function levelColor(level: number): string {
  return level < 0
    ? "var(--muted)"
    : `color-mix(in oklch, var(--stats-mark) ${LEVEL_MIX[level]}%, var(--muted))`;
}

interface ReadingHeatmapProps {
  days: SeriesPoint[];
  selected: DateKey | null;
  onSelect: (day: DateKey | null) => void;
}

/**
 * A year of days, one column a week. The readout under it shows the day under
 * the pointer or focus, so its values need no tooltip per cell. One Tab stop;
 * the arrow keys move between days.
 */
export function ReadingHeatmap({ days, selected, onSelect }: ReadingHeatmapProps) {
  const { t } = useT();
  const [hovered, setHovered] = useState<SeriesPoint | null>(null);
  const [focusIndex, setFocusIndex] = useState(days.length - 1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef(new Map<number, HTMLButtonElement>());
  const moveFocus = useRef(false);

  const weeks = useMemo(() => {
    const out: { point: SeriesPoint; index: number }[][] = [];
    days.forEach((point, index) => {
      if (index % 7 === 0) out.push([]);
      out[out.length - 1].push({ point, index });
    });
    return out;
  }, [days]);

  // Each month's name sits over its first whole week.
  const monthLabels = useMemo(() => {
    let last = weeks[0]?.[0]?.point.key.slice(0, 7);
    return weeks.map((week, index) => {
      const month = week[0].point.key.slice(0, 7);
      if (month === last || index === 0) return null;
      last = month;
      return formatMonth(month);
    });
  }, [weeks]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [days]);

  useEffect(() => {
    setFocusIndex(days.length - 1);
  }, [days.length]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    cellsRef.current.get(focusIndex)?.focus();
  }, [focusIndex]);

  const handleKeyDown = (event: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = focusIndex + delta;
    if (next < 0 || next >= days.length) return;
    moveFocus.current = true;
    setFocusIndex(next);
  };

  const readout = hovered ?? days.find((day) => day.key === selected) ?? null;

  return (
    <section aria-labelledby="stats-heatmap-title">
      <h3 id="stats-heatmap-title" className="mb-2 text-sm font-medium">
        {t("stats.heatmap.title")}
      </h3>
      <div ref={scrollRef} className="overflow-x-auto pb-3">
        <div className="w-max">
          <div className="mb-1 flex h-4 text-xs text-muted-foreground" aria-hidden>
            {monthLabels.map((label, index) => (
              <div
                key={index}
                className="overflow-visible whitespace-nowrap"
                style={{ width: CELL_PX + GAP_PX }}
              >
                {label}
              </div>
            ))}
          </div>
          <div
            role="group"
            aria-label={t("stats.heatmap.title")}
            className="flex"
            style={{ gap: GAP_PX }}
            onKeyDown={handleKeyDown}
            onPointerLeave={() => setHovered(null)}
          >
            {weeks.map((week) => (
              <div key={week[0].point.key} className="flex flex-col" style={{ gap: GAP_PX }}>
                {week.map(({ point, index }) => {
                  const label = `${formatFullDay(point.key)}: ${
                    point.seconds > 0 ? formatDuration(point.seconds) : t("stats.heatmap.none")
                  }`;
                  return (
                    <button
                      key={point.key}
                      ref={(node) => {
                        if (node) cellsRef.current.set(index, node);
                        else cellsRef.current.delete(index);
                      }}
                      type="button"
                      tabIndex={index === focusIndex ? 0 : -1}
                      aria-label={label}
                      aria-pressed={selected === point.key}
                      onClick={() => onSelect(selected === point.key ? null : point.key)}
                      onPointerEnter={(event) => {
                        // A finger on its way to scrolling is not pointing at a day.
                        if (event.pointerType === "mouse") setHovered(point);
                      }}
                      onFocus={() => {
                        setFocusIndex(index);
                        setHovered(point);
                      }}
                      onBlur={() => setHovered(null)}
                      className={cn(
                        "rounded-[2px] outline-offset-1 hover:outline hover:outline-1 hover:outline-foreground/40",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                        selected === point.key && "outline outline-2 outline-foreground",
                      )}
                      style={{
                        width: CELL_PX,
                        height: CELL_PX,
                        background: levelColor(levelOf(point.seconds)),
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-4 text-xs text-muted-foreground">
        <p aria-live="off" className="tabular-nums">
          {readout
            ? `${formatFullDay(readout.key)} · ${
                readout.seconds > 0 ? formatDuration(readout.seconds) : t("stats.heatmap.none")
              }`
            : t("stats.heatmap.hint")}
        </p>
        <div className="flex items-center gap-1" aria-hidden>
          <span className="mr-1">{t("stats.heatmap.less")}</span>
          {[-1, 0, 1, 2, 3].map((level) => (
            <span
              key={level}
              className="rounded-[2px]"
              style={{ width: CELL_PX, height: CELL_PX, background: levelColor(level) }}
            />
          ))}
          <span className="ml-1">{t("stats.heatmap.more")}</span>
        </div>
      </div>
    </section>
  );
}
