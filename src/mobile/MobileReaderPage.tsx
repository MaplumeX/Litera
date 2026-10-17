import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Bookmark, ChevronLeft, List, MessageSquare, NotebookPen, Search, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReaderView, type SelectionCapture } from "@/components/ReaderView";
import type { ChatPanelHandle } from "@/components/chat/ChatPanel";
import { ReaderProgressBar } from "@/components/ReaderProgressBar";
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
import { useT } from "@/lib/i18n";
import { AssistantSheet } from "@/mobile/AssistantSheet";
import { MobileSheet } from "@/mobile/MobileSheet";

export type ReaderPanel = "toc" | "search" | "annotations";

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
 * The phone's Reader: the Book edge to edge, tap zones and swipes to turn
 * pages, a middle tap for the toolbars, and the assistant as a bottom sheet.
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

  return (
    <div className="relative h-full min-h-0 overflow-hidden" data-testid="mobile-reader">
      <div className="absolute inset-0">
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

      {chromeVisible && (
        <>
          <header
            role="toolbar"
            aria-label={bookTitle}
            className="absolute inset-x-0 top-0 z-20 flex items-center gap-0.5 border-b bg-background/95 px-1 pt-[var(--android-inset-top,0px)] shadow-soft"
          >
            <Button size="icon" variant="ghost" onClick={onBack} aria-label={t("reader.backToLibrary")}>
              <ChevronLeft />
            </Button>
            <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-medium" title={bookTitle}>
              {shortBookTitle(bookTitle)}
            </h1>
            <Button size="icon-sm" variant="ghost" onClick={() => onPanelChange("toc")} aria-label={t("mobile.toc")}>
              <List />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => onPanelChange("search")} aria-label={t("search.title")}>
              <Search />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={session.handleAddBookmark}
              aria-label={t("annotations.addBookmark")}
            >
              <Bookmark />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onPanelChange("annotations")}
              aria-label={t("mobile.annotations")}
            >
              <NotebookPen />
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={onOpenTypography} aria-label={t("reader.fontAndTheme")}>
              <Type />
            </Button>
            <Button
              size="icon-sm"
              variant={snap === "collapsed" ? "ghost" : "secondary"}
              onClick={() => onSnapChange(snap === "collapsed" ? "half" : "collapsed")}
              aria-label={t("mobile.assistant")}
              aria-pressed={snap !== "collapsed"}
            >
              <MessageSquare />
            </Button>
          </header>
          <footer className="absolute inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[var(--android-inset-bottom,0px)]">
            <ReaderProgressBar
              fraction={progress.fraction}
              chapterLabel={session.chapterLabel}
              ticks={session.chapterTicks}
              onSeek={session.seekProgress}
              onPrevChapter={session.handlePrevChapter}
              onNextChapter={session.handleNextChapter}
              canPrevChapter={session.chapterNav.canPrev}
              canNextChapter={session.chapterNav.canNext}
              previewLabelAt={(frac) => readerRef.current?.previewLabelAt(frac)}
              canGoBack={session.readerHistory.canGoBack}
              canGoForward={session.readerHistory.canGoForward}
              onBack={() => readerRef.current?.goBack()}
              onForward={() => readerRef.current?.goForward()}
            />
          </footer>
        </>
      )}

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
