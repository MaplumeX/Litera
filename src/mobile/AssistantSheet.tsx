import { forwardRef, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import type { QuoteLocation } from "@/agent/book/book-content";
import { readerModeForSnap, snapAfterDrag, type SheetSnap } from "@/lib/assistant-sheet";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AssistantSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  bookId: string;
  currentChapterHref?: string;
  onOpenQuote: (location: QuoteLocation, quote: string) => void;
}

function sheetHeight(snap: SheetSnap, dragOffset: number) {
  return `calc(${snap === "full" ? "100%" : "50%"} - ${dragOffset}px)`;
}

/**
 * The reading assistant over the Book: half height keeps the page visible
 * above it, full screen is the conversation alone. Dragging the handle moves
 * between them (and down to collapsed). The panel stays mounted while
 * collapsed so a draft and the open Session survive.
 */
export const AssistantSheet = forwardRef<ChatPanelHandle, AssistantSheetProps>(
  function AssistantSheet({ snap, onSnapChange, bookId, currentChapterHref, onOpenQuote }, ref) {
    const { t } = useT();
    const sheetRef = useRef<HTMLElement>(null);
    const dragRef = useRef<{ pointerId: number; startY: number } | null>(null);

    const containerHeight = () => sheetRef.current?.parentElement?.getBoundingClientRect().height ?? 0;

    // The drag writes the sheet's height straight to the DOM: a state update
    // per pointer move would re-render the whole conversation every frame.
    const settle = (next: SheetSnap) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      delete sheet.dataset.dragging;
      sheet.style.height = sheetHeight(next, 0);
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = { pointerId: event.pointerId, startY: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const sheet = sheetRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !sheet) return;
      sheet.dataset.dragging = "";
      sheet.style.height = sheetHeight(snap, event.clientY - drag.startY);
    };
    const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      const next = snapAfterDrag(snap, event.clientY - drag.startY, containerHeight());
      settle(next);
      if (next !== snap) onSnapChange(next);
    };

    const collapsed = snap === "collapsed";
    return (
      <section
        ref={sheetRef}
        aria-label={t("mobile.assistantSheet")}
        data-snap={snap}
        // Collapsed, it slides below the edge and goes inert, still mounted.
        aria-hidden={collapsed}
        inert={collapsed}
        className={cn(
          "absolute inset-x-0 bottom-0 z-30 flex flex-col border-t bg-card shadow-float",
          snap === "full" ? "rounded-none pt-[var(--safe-top)]" : "rounded-t-2xl",
          collapsed && "invisible translate-y-full",
          "transition-[height,translate,visibility] duration-[var(--motion-enter)] ease-[var(--ease-emphasized-decelerate)] data-[dragging]:transition-none motion-reduce:transition-none",
        )}
        style={{
          height: sheetHeight(snap, 0),
          bottom: "var(--keyboard-inset)",
          maxHeight: snap === "full"
            ? "calc(100% - var(--keyboard-inset))"
            : "calc(100% - var(--keyboard-inset) - var(--safe-top))",
          paddingBottom: "var(--keyboard-safe-bottom)",
        }}
      >
        <div className="relative flex shrink-0 items-center gap-1 px-2">
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("mobile.sheetHandle")}
            className="h-8 flex-1 touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={() => {
              dragRef.current = null;
              settle(snap);
            }}
          >
            {/* Centered on the whole sheet, not the space left of the buttons. */}
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 h-1 w-10 -translate-1/2 rounded-full bg-muted-foreground/30"
            />
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onSnapChange(snap === "full" ? "half" : "full")}
            aria-label={snap === "full" ? t("mobile.sheetHalf") : t("mobile.sheetFull")}
          >
            {snap === "full" ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onSnapChange("collapsed")}
            aria-label={t("mobile.sheetClose")}
          >
            <ChevronDown />
          </Button>
        </div>
        <div className="assistant-sheet-body min-h-0 flex-1">
          <ChatPanel
            ref={ref}
            bookId={bookId}
            currentChapterHref={currentChapterHref}
            onOpenQuote={onOpenQuote}
            variant="docked"
            preferGuidedSession={readerModeForSnap(snap) === "agent"}
          />
        </div>
      </section>
    );
  },
);
