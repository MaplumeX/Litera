import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookmarkPlus,
  List,
  Moon,
  NotebookPen,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { ReaderView, type SelectionCapture } from "@/components/ReaderView";
import { ReaderFooter } from "@/components/ReaderFooter";
import type { ChatPanelHandle } from "@/components/chat/ChatPanel";
import { TocSidebar, TocSidebarActions } from "@/components/TocSidebar";
import { AnnotationsSidebar } from "@/components/AnnotationsSidebar";
import { BookSearchPanel } from "@/components/BookSearchPanel";
import { FinishBookPrompt } from "@/components/FinishBookPrompt";
import { KosyncPrompt } from "@/components/KosyncPrompt";
import type { QuoteLocation } from "@/agent/book/book-content";
import type { SheetSnap } from "@/lib/assistant-sheet";
import type { ReaderSession } from "@/lib/use-reader-session";
import { quoteTargetHref } from "@/lib/toc-items";
import { shortBookTitle } from "@/lib/book-title";
import { READER_FOOTER_POSITIONS, useReaderFooter } from "@/lib/reader-footer";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AppBarIconButton, MobileAppBar } from "@/mobile/MobileAppBar";
import { AssistantSheet } from "@/mobile/AssistantSheet";
import { MobileSheet } from "@/mobile/MobileSheet";
import { ReaderQuickSettings } from "@/mobile/ReaderQuickSettings";

export type ReaderPanel = "toc" | "search" | "annotations";

/** An icon over a short label: the bottom toolbar's entries. */
function ToolbarTab({
  icon: Icon,
  label,
  onClick,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-foreground/80 transition-colors active:bg-foreground/5 motion-reduce:transition-none"
    >
      <span
        className={cn(
          "flex h-8 w-14 items-center justify-center rounded-full transition-colors motion-reduce:transition-none",
          pressed && "bg-secondary text-foreground",
        )}
      >
        <Icon className="size-[1.375rem]" aria-hidden />
      </span>
      <span className="max-w-full truncate px-1 text-[0.6875rem] leading-none">{label}</span>
    </button>
  );
}

/**
 * Where you are and a slider to go elsewhere, between previous / next
 * chapter. Dragging previews the chapter under the thumb and jumps on
 * release; after a jump, the way back sits at the start of the row until
 * the reader reads on.
 */
function MobileProgressRow({ session }: { session: ReaderSession }) {
  const { t } = useT();
  const { progress, readerRef } = session;
  const [draft, setDraft] = useState<number | null>(null);
  const fraction = draft ?? progress.fraction;
  const pct = Math.round(fraction * 100);
  const label =
    draft == null ? session.chapterLabel : (readerRef.current?.previewLabelAt(draft) ?? session.chapterLabel);

  const commit = () => {
    if (draft == null) return;
    session.seekProgress(draft);
    setDraft(null);
  };

  const sideButton =
    "flex size-12 shrink-0 items-center justify-center rounded-full text-foreground/80 transition-colors active:bg-foreground/10 disabled:opacity-30 motion-reduce:transition-none [&_svg]:size-5";

  return (
    <div className="px-2 pt-2">
      <div className="flex items-center justify-between gap-3 px-4 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{pct}%</span>
      </div>
      <div className="flex items-center">
        {session.readerHistory.canGoBack && !session.readerHistory.readOn ? (
          <button
            type="button"
            className={sideButton}
            aria-label={t("reader.historyBack")}
            onClick={() => readerRef.current?.goBack()}
          >
            <Undo2 aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className={sideButton}
            aria-label={t("reader.prevChapter")}
            disabled={!session.chapterNav.canPrev}
            onClick={session.handlePrevChapter}
          >
            <SkipBack aria-hidden />
          </button>
        )}
        <input
          type="range"
          min={0}
          max={1000}
          step={1}
          aria-label={t("reader.progress")}
          aria-valuetext={t("reader.progressPreview", { chapter: label, pct })}
          value={Math.round(fraction * 1000)}
          onChange={(event) => setDraft(Number(event.target.value) / 1000)}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="h-12 min-w-0 flex-1 cursor-pointer accent-primary"
        />
        <button
          type="button"
          className={sideButton}
          aria-label={t("reader.nextChapter")}
          disabled={!session.chapterNav.canNext}
          onClick={session.handleNextChapter}
        >
          <SkipForward aria-hidden />
        </button>
      </div>
    </div>
  );
}

interface MobileReaderPageProps {
  session: ReaderSession;
  chromeVisible: boolean;
  onToggleChrome: () => void;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  panel: ReaderPanel | null;
  onPanelChange: (panel: ReaderPanel | null) => void;
  onBack: () => void;
  onOpenTypography: () => void;
}

/**
 * The phone's Reader: the Book edge to edge with a running head and foot,
 * tap zones and swipes to turn pages, and a middle tap for the toolbars: an
 * app bar on top, progress and the reader's tools at the bottom (contents,
 * notes, assistant, day/night, reading settings). The assistant is a bottom
 * sheet.
 */
export function MobileReaderPage({
  session,
  chromeVisible,
  onToggleChrome,
  snap,
  onSnapChange,
  panel,
  onPanelChange,
  onBack,
  onOpenTypography,
}: MobileReaderPageProps) {
  const { t } = useT();
  const { readerRef, fileData, currentBook, progress, toc, annotations, bookSearch } = session;
  const chatRef = useRef<ChatPanelHandle>(null);
  const pendingCaptureRef = useRef<SelectionCapture | null>(null);
  const pendingQuoteRef = useRef<{ href: string; quote: string } | null>(null);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [footerSettings] = useReaderFooter();

  // "Ask" on a selection: open the sheet with the passage attached.
  const handleSelectionCapture = useCallback(
    (capture: SelectionCapture) => {
      if (snap === "collapsed") {
        pendingCaptureRef.current = capture;
        onSnapChange("half");
        return;
      }
      chatRef.current?.fillInput(capture.text, capture.chapterHref);
    },
    [onSnapChange, snap],
  );

  useLayoutEffect(() => {
    if (snap === "collapsed") return;
    const pending = pendingCaptureRef.current;
    if (!pending) return;
    pendingCaptureRef.current = null;
    chatRef.current?.fillInput(pending.text, pending.chapterHref);
  }, [snap]);

  // A Citation's "Open in Book": a full-screen sheet steps down to half so
  // the passage shows above it.
  const handleOpenQuote = useCallback(
    (location: QuoteLocation, quote: string) => {
      if (!location.href) return;
      const href = quoteTargetHref(toc, location.href);
      if (snap === "full") {
        pendingQuoteRef.current = { href, quote };
        onSnapChange("half");
        return;
      }
      void readerRef.current?.goToQuote(href, quote);
    },
    [onSnapChange, readerRef, snap, toc],
  );

  useEffect(() => {
    if (snap === "full") return;
    const pending = pendingQuoteRef.current;
    if (!pending) return;
    pendingQuoteRef.current = null;
    const frame = requestAnimationFrame(() => {
      void readerRef.current?.goToQuote(pending.href, pending.quote);
    });
    return () => cancelAnimationFrame(frame);
  }, [readerRef, snap]);

  const jumpAndClose = async (cfi: string, fraction?: number) => {
    await session.jumpToCfi(cfi, fraction);
    onPanelChange(null);
  };

  const bookTitle = session.bookTitle;
  const panelTitle =
    panel === "toc"
      ? t("mobile.toc")
      : panel === "search"
        ? t("search.title")
        : t("mobile.annotations");
  const dark = session.resolvedTheme === "dark";
  const paginated = session.readerFlow === "paginated";
  const reserveFooter = !paginated && footerSettings.enabled &&
    READER_FOOTER_POSITIONS.some((position) => footerSettings[position] !== "none");

  return (
    <div className="relative h-full min-h-0 overflow-hidden" data-testid="mobile-reader">
      {/* The cutout stays when the bars hide, so the page keeps clear of it
          and doesn't reflow as the toolbars come and go. */}
      <div
        className="absolute inset-x-0 top-[var(--android-cutout-top,0px)] bottom-[var(--android-cutout-bottom,0px)]"
        style={{ paddingBottom: reserveFooter ? "3rem" : undefined }}
      >
        {fileData && (
          <ReaderView
            ref={readerRef}
            fileData={fileData}
            onRelocate={session.handleRelocate}
            onSelectionCapture={handleSelectionCapture}
            onHighlight={session.handleAddHighlight}
            onUpdateHighlight={session.handleUpdateHighlight}
            onDeleteHighlight={session.handleDeleteHighlight}
            highlights={annotations.highlights}
            initialFraction={currentBook?.lastFraction}
            initialCfi={currentBook?.lastCfi}
            onBookReady={session.handleBookReady}
            onHistoryChange={session.setReaderHistory}
            keysDisabled={snap === "full"}
            stylesCss={session.stylesCss}
            onMiddleTap={onToggleChrome}
          />
        )}
        {/* The running head stays in the paginated top margin. */}
        {fileData && paginated && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 flex h-12 items-center px-6 text-[0.6875rem] text-muted-foreground/80"
          >
            <span className="truncate">{session.chapterLabel}</span>
          </div>
        )}
        {fileData && (
          <ReaderFooter
            chapterLabel={session.chapterLabel}
            fraction={progress.fraction}
            ticks={session.chapterTicks}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-12 px-6 text-[0.6875rem] text-muted-foreground/80"
          />
        )}
        {session.kosync.prompt && (
          <KosyncPrompt
            prompt={session.kosync.prompt}
            onJump={session.kosync.accept}
            onStay={session.kosync.dismiss}
          />
        )}
        {session.readingStatus.finishPromptOpen && (
          <FinishBookPrompt
            onMarkFinished={() => void session.readingStatus.markFinished()}
            onDismiss={session.readingStatus.dismissFinishPrompt}
          />
        )}
      </div>

      {/* The toolbars stay mounted and slide off the edges; hidden, they're
          inert so neither touch nor a screen reader finds them. */}
      <>
          <div
            role="toolbar"
            aria-label={bookTitle}
            aria-hidden={!chromeVisible}
            inert={!chromeVisible}
            data-shown={chromeVisible}
            className={cn(
              "m-slide absolute inset-x-0 top-0 z-20 bg-background shadow-soft",
              !chromeVisible && "invisible -translate-y-full",
            )}
          >
            <MobileAppBar
              navigation={
                <AppBarIconButton label={t("reader.backToLibrary")} onClick={onBack}>
                  <ArrowLeft />
                </AppBarIconButton>
              }
              title={<span className="text-base font-medium" title={bookTitle}>{shortBookTitle(bookTitle)}</span>}
              actions={
                <>
                  <AppBarIconButton label={t("search.title")} onClick={() => onPanelChange("search")}>
                    <Search />
                  </AppBarIconButton>
                  <AppBarIconButton label={t("annotations.addBookmark")} onClick={session.handleAddBookmark}>
                    <BookmarkPlus />
                  </AppBarIconButton>
                </>
              }
            />
          </div>
          <div
            role="toolbar"
            aria-label={t("reader.progress")}
            aria-hidden={!chromeVisible}
            inert={!chromeVisible}
            data-shown={chromeVisible}
            className={cn(
              "m-slide absolute inset-x-0 bottom-0 z-20 bg-background pb-[var(--safe-bottom)] shadow-float",
              !chromeVisible && "invisible translate-y-full",
            )}
          >
            <MobileProgressRow session={session} />
            <nav className="grid grid-cols-5 px-1 pb-1">
              <ToolbarTab icon={List} label={t("mobile.toc")} onClick={() => onPanelChange("toc")} />
              <ToolbarTab
                icon={NotebookPen}
                label={t("mobile.annotations")}
                onClick={() => onPanelChange("annotations")}
              />
              <ToolbarTab
                icon={Sparkles}
                label={t("mobile.assistant")}
                pressed={snap !== "collapsed"}
                onClick={() => onSnapChange(snap === "collapsed" ? "half" : "collapsed")}
              />
              <ToolbarTab
                icon={dark ? Sun : Moon}
                label={dark ? t("mobile.day") : t("mobile.night")}
                onClick={() => session.setGlobalTheme(dark ? "light" : "dark")}
              />
              <ToolbarTab
                icon={Type}
                label={t("mobile.readingSettings")}
                onClick={() => setQuickSettingsOpen(true)}
              />
            </nav>
          </div>
      </>

      <ReaderQuickSettings
        open={quickSettingsOpen}
        onOpenChange={setQuickSettingsOpen}
        styleState={session.styleState}
        onTypographyChange={session.handleTypographyChange}
        theme={session.globalTheme}
        onThemeChange={session.setGlobalTheme}
        flow={session.readerFlow}
        onFlowChange={session.setReaderFlow}
        onMoreSettings={() => {
          setQuickSettingsOpen(false);
          onOpenTypography();
        }}
      />

      {fileData && (
        <AssistantSheet
          ref={chatRef}
          snap={snap}
          onSnapChange={onSnapChange}
          bookId={fileData.bookId}
          currentChapterHref={progress.chapterHref}
          onOpenQuote={handleOpenQuote}
        />
      )}

      <MobileSheet
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) onPanelChange(null);
        }}
        title={panelTitle}
        className="h-[85vh]"
      >
        {panel === "toc" && (
          <div className="flex h-full flex-col">
            <div className="flex justify-end px-2">
              <TocSidebarActions
                onExpandAll={session.handleTocExpandAll}
                onCollapseAll={session.handleTocCollapseAll}
              />
            </div>
            <TocSidebar
              toc={toc}
              currentHref={progress.chapterHref}
              expanded={session.tocExpanded}
              onToggle={session.handleTocToggle}
              onGoTo={(href) => {
                session.goToChapterHref(href);
                onPanelChange(null);
              }}
            />
          </div>
        )}
        {panel === "search" && (
          <BookSearchPanel
            query={bookSearch.query}
            onQueryChange={bookSearch.setQuery}
            onSubmit={bookSearch.submit}
            onStep={bookSearch.step}
            onSelect={(hit) => {
              bookSearch.select(hit);
              onPanelChange(null);
            }}
            onClear={bookSearch.reset}
            results={bookSearch.results}
            status={bookSearch.status}
            activeCfi={bookSearch.activeCfi}
            focusToken={0}
          />
        )}
        {panel === "annotations" && (
          <AnnotationsSidebar
            bookmarks={annotations.bookmarks}
            highlights={annotations.highlights}
            onAddBookmark={session.handleAddBookmark}
            onJumpBookmark={(bookmark) => void jumpAndClose(bookmark.cfi, bookmark.fraction)}
            onDeleteBookmark={session.handleDeleteBookmark}
            onJumpHighlight={(highlight) => void jumpAndClose(highlight.cfi)}
            onDeleteHighlight={session.handleDeleteHighlight}
          />
        )}
      </MobileSheet>
    </div>
  );
}
