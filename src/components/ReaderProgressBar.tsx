import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { fractionFromPointer, movedPastSlop } from "@/lib/reader-progress";
import { cn } from "@/lib/utils";

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
      className="flex h-9 shrink-0 items-center gap-1 border-t px-2"
    >
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
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
        className="relative flex h-9 min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
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
            className="pointer-events-none absolute top-0.5 z-10 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] text-popover-foreground"
            style={{ left: `${Math.round((previewFrac ?? visualFraction) * 100)}%` }}
          >
            {previewText}
          </div>
        )}
        <div className="relative h-0.5 w-full rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full bg-primary",
              draftFraction == null &&
                "transition-[width] duration-200 motion-reduce:transition-none",
            )}
            style={{ width: `${visualPct}%` }}
          />
          {ticks.map((tick, i) => (
            <div
              key={`${tick}-${i}`}
              data-testid="reader-progress-tick"
              className="pointer-events-none absolute top-1/2 h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-muted-foreground/50"
              style={{ left: `${tick * 100}%` }}
            />
          ))}
          <div
            className={cn(
              "pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary",
              draftFraction != null && "scale-125",
            )}
            style={{ left: `${visualPct}%` }}
          />
        </div>
      </div>
      <span className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {visualPct}%
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={!canNextChapter}
        aria-label={t("reader.nextChapter")}
        onClick={() => onNextChapter?.()}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
