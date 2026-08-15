import { useRef } from "react";
import { fractionFromPointer } from "@/lib/reader-progress";

const SEEK_THROTTLE_MS = 50;

interface ReaderProgressBarProps {
  fraction: number;
  chapterLabel: string;
  onSeek: (frac: number) => void;
}

export function ReaderProgressBar({
  fraction,
  chapterLabel,
  onSeek,
}: ReaderProgressBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const lastMoveAtRef = useRef(0);
  const pct = Math.round(fraction * 100);

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onSeek(fractionFromPointer(clientX, rect.left, rect.width));
  };

  return (
    <div className="flex h-5 items-center gap-3 border-b px-4">
      <div
        ref={trackRef}
        className="flex h-full min-w-0 flex-1 cursor-pointer touch-none select-none items-center"
        aria-label={`${chapterLabel} · ${pct}%`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          draggingRef.current = true;
          lastMoveAtRef.current = e.timeStamp;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          if (e.timeStamp - lastMoveAtRef.current < SEEK_THROTTLE_MS) return;
          lastMoveAtRef.current = e.timeStamp;
          seekFromClientX(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          seekFromClientX(e.clientX);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div className="h-0.5 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {chapterLabel} · {pct}%
      </span>
    </div>
  );
}
