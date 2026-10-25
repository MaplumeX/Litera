import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AlertCircle, ChevronDown, Loader2, Maximize2, Minimize2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import type { QuoteLocation } from "@/agent/book/book-content";
import { readerModeForSnap, snapAfterDrag, type SheetSnap } from "@/lib/assistant-sheet";
import type { ChatActivity } from "@/lib/chat-activity";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface AssistantSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  bookId: string;
  currentChapterHref?: string;
  onOpenQuote: (location: QuoteLocation, quote: string) => void;
  /** How far above the bottom edge the peek bar sits (a CSS length): clear of the toolbar while it shows. */
  peekOffset?: string;
}

const NO_ACTIVITY: ChatActivity = { answering: false, preview: "", failed: false };

function sheetHeight(snap: SheetSnap, dragOffset: number) {
  return `calc(${snap === "full" ? "100%" : "50%"} - ${dragOffset}px)`;
}

/**
 * The reading assistant over the Book: half height keeps the page visible
 * above it, full screen is the conversation alone. Dragging the handle moves
 * between them (and down to collapsed). The panel stays mounted while
 * collapsed so a draft and the open Session survive.
 *
 * Collapsed while an answer is coming, or with one that came in unseen, a
 * peek bar over the page says so; tapping it brings the sheet back to half.
 */
export const AssistantSheet = forwardRef<ChatPanelHandle, AssistantSheetProps>(
  function AssistantSheet(
    { snap, onSnapChange, bookId, currentChapterHref, onOpenQuote, peekOffset = "var(--safe-bottom)" },
    ref,
  ) {
    const { t } = useT();
    const sheetRef = useRef<HTMLElement>(null);
    const dragRef = useRef<{ pointerId: number; startY: number } | null>(null);

    const [activity, setActivity] = useState(NO_ACTIVITY);
    // An answer that finished while the sheet was collapsed.
    const [unseen, setUnseen] = useState(false);
    const [peekDismissed, setPeekDismissed] = useState(false);
    const activityRef = useRef(NO_ACTIVITY);
    const snapRef = useRef(snap);
    snapRef.current = snap;
    const handleActivity = useCallback((next: ChatActivity) => {
      const previous = activityRef.current;
      activityRef.current = next;
      // A new answer brings a dismissed peek back.
      if (next.answering && !previous.answering) setPeekDismissed(false);
      if (previous.answering && !next.answering && snapRef.current === "collapsed") setUnseen(true);
      setActivity(next);
    }, []);
    useEffect(() => {
      if (snap === "collapsed") return;
      setUnseen(false);
      setPeekDismissed(false);
    }, [snap]);

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

    const preferGuidedSession = readerModeForSnap(snap) === "agent";
    // The peek's state changes stay out of the conversation's renders.
    const chatPanel = useMemo(
      () => (
        <ChatPanel
          ref={ref}
          bookId={bookId}
          currentChapterHref={currentChapterHref}
          onOpenQuote={onOpenQuote}
          variant="docked"
          preferGuidedSession={preferGuidedSession}
          onActivityChange={handleActivity}
        />
      ),
      [ref, bookId, currentChapterHref, onOpenQuote, preferGuidedSession, handleActivity],
    );

    const collapsed = snap === "collapsed";
    const peekShown = collapsed && !peekDismissed && (activity.answering || unseen);
    const peekStatus = activity.answering
      ? t("mobile.peekAnswering")
      : activity.failed
        ? t("mobile.peekFailed")
        : t("mobile.peekAnswered");
    return (
      <>
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
          <div className="assistant-sheet-body min-h-0 flex-1">{chatPanel}</div>
        </section>
        {peekShown && (
          <div
            role="region"
            aria-label={t("mobile.assistantPeek")}
            className="absolute inset-x-3 z-30 flex items-center gap-1 rounded-2xl border bg-card p-1 shadow-float transition-[bottom] duration-[var(--motion-feedback)] ease-[var(--ease-emphasized-decelerate)] m-rise motion-reduce:transition-none"
            style={{ bottom: `calc(${peekOffset} + 0.5rem)` }}
          >
            <button
              type="button"
              onClick={() => onSnapChange("half")}
              aria-label={t("mobile.peekOpen")}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-foreground/5"
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary">
                {activity.answering ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                ) : activity.failed ? (
                  <AlertCircle className="size-4 text-destructive" />
                ) : (
                  <Sparkles className="size-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span role="status" className="block text-xs text-muted-foreground">{peekStatus}</span>
                {activity.preview && <span className="block truncate text-sm">{activity.preview}</span>}
              </span>
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setPeekDismissed(true)}
              aria-label={t("mobile.peekDismiss")}
            >
              <X />
            </Button>
          </div>
        )}
      </>
    );
  },
);
