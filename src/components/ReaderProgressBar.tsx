import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { fractionFromPointer, movedPastSlop } from "@/lib/reader-progress";
import { cn } from "@/lib/utils";

const CHAPTER_ARROW_CLASS =
  "opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none";

interface ReaderProgressBarProps {
  fraction: number;
  chapterLabel: string;
  ticks?: number[];
  onSeek: (frac: number) => void;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  canPrevChapter?: boolean;
  canNextChapter?: boolean;
  previewLabelAt?: (frac: number) => string | undefined;
}

export function ReaderProgressBar({
  fraction,
  chapterLabel,
  ticks = [],
  onSeek,
  onPrevChapter,
  onNextChapter,
  canPrevChapter = false,
  canNextChapter = false,
  previewLabelAt,
}: ReaderProgressBarProps) {
  const { t } = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const [draftFraction, setDraftFraction] = useState<number | null>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const visualFraction = draftFraction ?? fraction;
  const visualPct = Math.round(visualFraction * 100);
  const previewFrac = draftFraction ?? hoverFraction;
  const previewPct = previewFrac == null ? visualPct : Math.round(previewFrac * 100);
  const previewChapter =
    previewFrac == null ? undefined : previewLabelAt?.(previewFrac);
  const previewText =
    previewFrac == null
      ? undefined
      : previewChapter
        ? t("reader.progressPreview", { chapter: previewChapter, pct: previewPct })
        : t("reader.progressPercent", { pct: previewPct });

  const fractionAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return fractionFromPointer(clientX, rect.left, rect.width);
  };

  return (
    <div
      data-testid="reader-progress-bar"
      className="group/bar flex h-11 shrink-0 items-center gap-1 px-2 pb-2"
    >
      {/* Chapter arrows repeat page turning, so they stay out of sight until
          the bar is hovered or reached by keyboard. */}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={CHAPTER_ARROW_CLASS}
        disabled={!canPrevChapter}
        aria-label={t("reader.prevChapter")}
        onClick={() => onPrevChapter?.()}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-0 max-w-[9rem] shrink truncate text-xs text-muted-foreground">
        {chapterLabel}
      </span>
      <div
        ref={trackRef}
        className="group/progress relative flex h-9 min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
        data-dragging={draftFraction != null || undefined}
        aria-label={t("reader.progress")}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          draggingRef.current = true;
          startXRef.current = e.clientX;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setHoverFraction(null);
          setDraftFraction(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) {
            setHoverFraction(fractionAt(e.clientX));
            return;
          }
          if (movedPastSlop(e.clientX - startXRef.current)) {
            setDraftFraction(fractionAt(e.clientX));
          }
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          const next = fractionAt(e.clientX);
          setDraftFraction(null);
          onSeek(next);
        }}
        onPointerCancel={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          setDraftFraction(null);
        }}
        onPointerLeave={() => {
          if (!draggingRef.current) setHoverFraction(null);
        }}
      >
        {previewText && (
          <div
            data-testid="reader-progress-preview"
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground tabular-nums shadow-float"
            style={{ left: `${Math.round((previewFrac ?? visualFraction) * 100)}%` }}
          >
            {previewText}
          </div>
        )}
        {/* Rail thickens on hover / drag so the seek target is easier to hit. */}
        <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/10 transition-[height] duration-150 group-hover/progress:h-1.5 group-data-[dragging]/progress:h-1.5 motion-reduce:transition-none">
          <div
            className={cn(
              "h-full rounded-full bg-primary",
              draftFraction == null &&
                "transition-[width] duration-200 motion-reduce:transition-none",
            )}
            style={{ width: `${visualPct}%` }}
          />
          {/* Chapter boundaries cut the rail only while seeking: at rest a
              book with many short chapters would read as a dashed line. */}
          {ticks.map((tick, i) => (
            <div
              key={`${tick}-${i}`}
              data-testid="reader-progress-tick"
              className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-background opacity-0 transition-opacity duration-150 group-hover/progress:opacity-100 group-data-[dragging]/progress:opacity-100 motion-reduce:transition-none"
              style={{ left: `${tick * 100}%` }}
            />
          ))}
        </div>
        <div
          className={cn(
            "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-75 rounded-full border-2 border-primary bg-background opacity-0 shadow-soft transition-[opacity,scale] duration-150 group-hover/progress:scale-100 group-hover/progress:opacity-100 motion-reduce:transition-none",
            draftFraction != null && "scale-110 opacity-100",
          )}
          style={{ left: `${visualPct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {visualPct}%
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={CHAPTER_ARROW_CLASS}
        disabled={!canNextChapter}
        aria-label={t("reader.nextChapter")}
        onClick={() => onNextChapter?.()}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
