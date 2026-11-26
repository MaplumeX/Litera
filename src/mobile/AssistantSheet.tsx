import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AlertCircle, BookOpen, ChevronDown, Loader2, Maximize2, MessageSquare, Minimize2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatWorkspace, type ChatWorkspaceHandle } from "@/components/chat/ChatWorkspace";
import { GuideWorkspace, type GuideWorkspaceHandle } from "@/components/guide/GuideWorkspace";
import type { QuoteLocation } from "@/agent/book/book-content";
import type { GuideBlockTarget } from "@/lib/guide-marks";
import {
  snapAfterDrag,
  type AssistantSheetTab,
  type SheetSnap,
} from "@/lib/assistant-sheet";
import type { ChatActivity } from "@/lib/chat-activity";
import type { GuideSelection } from "@/types/agent";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface AssistantSheetHandle {
  fillInput: (text: string, chapterHref?: string) => void;
  guideTo: (selection: GuideSelection) => void;
  guideChapter: (href: string) => void;
  scrollToMessage: (messageIndex: number) => void;
}

interface AssistantSheetProps {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  tab?: AssistantSheetTab;
  onTabChange?: (tab: AssistantSheetTab) => void;
  bookId: string;
  currentChapterHref?: string;
  onOpenQuote: (location: QuoteLocation, quote: string, block?: GuideBlockTarget) => void;
  /** How far above the bottom edge the peek bar sits (a CSS length): clear of the toolbar while it shows. */
  peekOffset?: string;
}

const NO_ACTIVITY: ChatActivity = { answering: false, preview: "", failed: false };

function sheetHeight(snap: SheetSnap, dragOffset: number) {
  return `calc(${snap === "full" ? "100%" : "50%"} - ${dragOffset}px)`;
}

/**
 * The phone's reading assistant sheet over the Book with explicit Guide / Ask
 * tabs, mounting `GuideWorkspace` and `ChatWorkspace` independently.
 */
export const AssistantSheet = forwardRef<AssistantSheetHandle, AssistantSheetProps>(
  function AssistantSheet(
    { snap, onSnapChange, tab: controlledTab, onTabChange: controlledOnTabChange, bookId, currentChapterHref, onOpenQuote, peekOffset = "var(--safe-bottom)" },
    ref,
  ) {
    const { t } = useT();
    const [uncontrolledTab, setUncontrolledTab] = useState<AssistantSheetTab>("ask");
    const tab = controlledTab ?? uncontrolledTab;
    const onTabChange = useCallback(
      (next: AssistantSheetTab) => {
        if (controlledOnTabChange) controlledOnTabChange(next);
        else setUncontrolledTab(next);
      },
      [controlledOnTabChange],
    );
    const sheetRef = useRef<HTMLElement>(null);
    const chatRef = useRef<ChatWorkspaceHandle>(null);
    const guideRef = useRef<GuideWorkspaceHandle>(null);
    const dragRef = useRef<{ pointerId: number; startY: number } | null>(null);

    const [activity, setActivity] = useState(NO_ACTIVITY);
    const [unseen, setUnseen] = useState(false);
    const [peekDismissed, setPeekDismissed] = useState(false);
    const activityRef = useRef(NO_ACTIVITY);
    const snapRef = useRef(snap);
    snapRef.current = snap;

    const handleActivity = useCallback((next: ChatActivity) => {
      const previous = activityRef.current;
      activityRef.current = next;
      if (next.answering && !previous.answering) setPeekDismissed(false);
      if (previous.answering && !next.answering && snapRef.current === "collapsed") setUnseen(true);
      setActivity(next);
    }, []);

    useEffect(() => {
      if (snap === "collapsed") return;
      setUnseen(false);
      setPeekDismissed(false);
    }, [snap]);

    useImperativeHandle(
      ref,
      () => ({
        fillInput: (text, chapterHref) => {
          if (tab === "guide") guideRef.current?.fillInput(text, chapterHref);
          else chatRef.current?.fillInput(text, chapterHref);
        },
        guideTo: (selection) => {
          if (tab !== "guide") onTabChange("guide");
          requestAnimationFrame(() => guideRef.current?.guideTo(selection));
        },
        guideChapter: (href) => {
          if (tab !== "guide") onTabChange("guide");
          requestAnimationFrame(() => guideRef.current?.guideChapter(href));
        },
        scrollToMessage: (messageIndex) => {
          if (tab !== "guide") onTabChange("guide");
          requestAnimationFrame(() => guideRef.current?.scrollToMessage(messageIndex));
        },
      }),
      [onTabChange, tab],
    );

    const containerHeight = () => sheetRef.current?.parentElement?.getBoundingClientRect().height ?? 0;

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

    const body = useMemo(
      () =>
        tab === "guide" ? (
          <GuideWorkspace
            ref={guideRef}
            bookId={bookId}
            currentChapterHref={currentChapterHref}
            onOpenQuote={onOpenQuote}
            variant="docked"
            onActivityChange={handleActivity}
          />
        ) : (
          <ChatWorkspace
            ref={chatRef}
            bookId={bookId}
            currentChapterHref={currentChapterHref}
            onOpenQuote={onOpenQuote}
            variant="docked"
            ordinarySessionsOnly
            onOpenGuideMode={() => onTabChange("guide")}
            onActivityChange={handleActivity}
          />
        ),
      [bookId, currentChapterHref, handleActivity, onOpenQuote, onTabChange, tab],
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
          data-tab={tab}
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
            maxHeight:
              snap === "full"
                ? "calc(100% - var(--keyboard-inset))"
                : "calc(100% - var(--keyboard-inset) - var(--safe-top))",
            paddingBottom: "var(--keyboard-safe-bottom)",
          }}
        >
          <div className="relative flex shrink-0 items-center gap-1 px-2">
            <div role="tablist" className="z-10 flex items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "guide"}
                onClick={() => onTabChange("guide")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  tab === "guide"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <BookOpen className="h-3 w-3" aria-hidden />
                {t("mobile.sheetTabGuide")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "ask"}
                onClick={() => onTabChange("ask")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  tab === "ask"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <MessageSquare className="h-3 w-3" aria-hidden />
                {t("mobile.sheetTabAsk")}
              </button>
            </div>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("mobile.sheetHandle")}
              className="h-9 flex-1 touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={() => {
                dragRef.current = null;
                settle(snap);
              }}
            >
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
          <div className="assistant-sheet-body min-h-0 flex-1">{body}</div>
        </section>
        {peekShown && (
          <div
            role="region"
            aria-label={t("mobile.assistantPeek")}
            className="absolute inset-x-3 z-30 flex items-center gap-1 rounded-2xl bg-card p-1 shadow-float transition-[bottom] duration-[var(--motion-feedback)] ease-[var(--ease-emphasized-decelerate)] m-rise motion-reduce:transition-none"
            style={{ bottom: `calc(${peekOffset} + 0.5rem)` }}
          >
            <button
              type="button"
              onClick={() => onSnapChange("half")}
              aria-label={t("mobile.peekOpen")}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left active:bg-foreground/5"
            >
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
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
