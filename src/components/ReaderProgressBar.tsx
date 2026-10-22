import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Redo2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReaderFooter } from "@/components/ReaderFooter";
import { useT } from "@/lib/i18n";
import {
  chapterBoundsAt,
  fractionFromPointer,
  movedPastSlop,
  percentOf,
} from "@/lib/reader-progress";
import { cn } from "@/lib/utils";

const CHAPTER_ARROW_CLASS =
  "opacity-0 transition-opacity duration-150 group-hover/bar:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none";

/** Arrow keys nudge the position by 1% of the book. */
const KEY_STEP = 0.01;

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
  /** Return to where the last jump started; shown only when there is one. */
  onBack?: () => void;
  onForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
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
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
}: ReaderProgressBarProps) {
  const { t } = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const [draftFraction, setDraftFraction] = useState<number | null>(null);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const visualFraction = draftFraction ?? fraction;
  const visualPct = percentOf(visualFraction);
  const previewFrac = draftFraction ?? hoverFraction;
  const previewPct = previewFrac == null ? visualPct : percentOf(previewFrac);
  const previewChapter =
    previewFrac == null ? undefined : previewLabelAt?.(previewFrac);
  const previewText =
    previewFrac == null
      ? undefined
      : previewChapter
        ? t("reader.progressPreview", { chapter: previewChapter, pct: previewPct })
        : t("reader.progressPercent", { pct: previewPct });

  // With a single chapter the chapter is the book; skip the duplicate readout.
  const chapter = ticks.length > 2 ? chapterBoundsAt(visualFraction, ticks) : undefined;

  const fractionAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return fractionFromPointer(clientX, rect.left, rect.width);
  };

  return (
    <div
      data-testid="reader-progress-bar"
      className="group/bar shrink-0 px-2 pb-2"
    >
      <div className="flex h-9 items-center gap-1">
        {/* Back / forward show right after a jump, when the way back is the
            thing the reader is looking for; App hides them once the reader
            reads on. */}
        {canGoBack && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("reader.historyBack")}
            title={t("reader.historyBack")}
            onClick={() => onBack?.()}
          >
            <Undo2 />
          </Button>
        )}
        {canGoForward && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t("reader.historyForward")}
            title={t("reader.historyForward")}
            onClick={() => onForward?.()}
          >
            <Redo2 />
          </Button>
        )}
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
        <div
          ref={trackRef}
          className="group/progress relative flex h-9 min-w-0 flex-1 cursor-pointer touch-none select-none items-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          data-dragging={draftFraction != null || undefined}
          role="slider"
          tabIndex={0}
          aria-label={t("reader.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={visualPct}
          aria-valuetext={t("reader.progressPreview", { chapter: chapterLabel, pct: visualPct })}
          onKeyDown={(e) => {
            if (draggingRef.current) return;
            switch (e.key) {
              case "ArrowRight":
              case "ArrowUp":
                onSeek(Math.min(1, fraction + KEY_STEP));
                break;
              case "ArrowLeft":
              case "ArrowDown":
                onSeek(Math.max(0, fraction - KEY_STEP));
                break;
              case "Home":
                onSeek(0);
                break;
              case "End":
                onSeek(1);
                break;
              case "PageUp":
                if (canPrevChapter) onPrevChapter?.();
                break;
              case "PageDown":
                if (canNextChapter) onNextChapter?.();
                break;
              default:
                return;
            }
            e.preventDefault();
          }}
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
              className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground tabular-nums shadow-float"
              // Shifting by the same fraction of its own width keeps the bubble
              // inside the track: left-aligned at 0%, centred at 50%, right-aligned at 100%.
              style={{
                left: `${(previewFrac ?? visualFraction) * 100}%`,
                transform: `translateX(-${(previewFrac ?? visualFraction) * 100}%)`,
              }}
            >
              {previewText}
            </div>
          )}
          {/* Rail thickens on hover / drag so the seek target is easier to hit. */}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/10 transition-[height] duration-150 group-hover/progress:h-1.5 group-focus-visible/progress:h-1.5 group-data-[dragging]/progress:h-1.5 motion-reduce:transition-none">
            {/* The rest of the current chapter, tinted so its end is visible. */}
            {chapter && (
              <div
                data-testid="reader-chapter-remaining"
                className={cn(
                  "absolute inset-y-0 bg-primary/25",
                  draftFraction == null &&
                    "transition-[left,width] duration-200 motion-reduce:transition-none",
                )}
                style={{ left: `${visualPct}%`, width: `${Math.max(0, chapter.end * 100 - visualPct)}%` }}
              />
            )}
            <div
              className={cn(
                "relative h-full rounded-full bg-primary",
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
                className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-background opacity-0 transition-opacity duration-150 group-hover/progress:opacity-100 group-focus-visible/progress:opacity-100 group-data-[dragging]/progress:opacity-100 motion-reduce:transition-none"
                style={{ left: `${tick * 100}%` }}
              />
            ))}
          </div>
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-75 rounded-full border-2 border-primary bg-background opacity-0 shadow-soft transition-[opacity,scale] duration-150 group-hover/progress:scale-100 group-hover/progress:opacity-100 group-focus-visible/progress:scale-100 group-focus-visible/progress:opacity-100 motion-reduce:transition-none",
              draftFraction != null && "scale-110 opacity-100",
            )}
            style={{ left: `${visualPct}%` }}
          />
        </div>
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
      <ReaderFooter chapterLabel={chapterLabel} fraction={visualFraction} ticks={ticks} className="h-6 px-2" />
    </div>
  );
}
