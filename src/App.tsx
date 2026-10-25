import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import {
  WindowControls,
  titlebarClassName,
  useTitlebarWindowDrag,
} from "@/components/WindowControls";
import {
  BookText,
  ChevronLeft,
  List,
  MessageSquare,
  PanelLeft,
  Pause,
  Type,
  Volume2,
} from "lucide-react";
import { ReaderView, type SelectionCapture } from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import type { GuideChapterProgress } from "@/agent/runtime/guide";
import type { GuideStep } from "@/types/agent";
import type { QuoteLocation } from "@/agent/book/book-content";
import { LibraryView } from "@/components/LibraryView";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { ReaderProgressBar } from "@/components/ReaderProgressBar";
import { ReaderTtsBar } from "@/components/ReaderTtsBar";
import { TocSidebar, TocSidebarActions } from "@/components/TocSidebar";
import { ReaderSidePanel, type ReaderSidePanelTab } from "@/components/ReaderSidePanel";
import { AnnotationsSidebar } from "@/components/AnnotationsSidebar";
import { BookSearchPanel } from "@/components/BookSearchPanel";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import type { BookmarkRecord, HighlightRecord } from "@/types/library";
import { invokeErrorMessage } from "@/lib/app-error";
import { useBookImport } from "@/lib/use-book-import";
import { useOpenPaths } from "@/lib/use-open-paths";
import { useIncomingBooks } from "@/lib/use-incoming-books";
import { usePlatformLifecycle } from "@/lib/use-platform-lifecycle";
import { useReaderSession } from "@/lib/use-reader-session";
import { useSyncScheduler } from "@/lib/use-sync-scheduler";
import { pushBeforeLeaving } from "@/lib/sync-runner";
import { useT } from "@/lib/i18n";
import { shortBookTitle } from "@/lib/book-title";
import { cn } from "@/lib/utils";
import { clampTocWidth, loadTocWidth, saveTocWidth } from "@/lib/toc-sidebar-width";
import {
  clampAgentBookWidth,
  loadAgentBookWidth,
  saveAgentBookWidth,
} from "@/lib/agent-book-width";
import {
  clampChatPanelWidth,
  loadChatPanelWidth,
  saveChatPanelWidth,
} from "@/lib/chat-panel-width";
import { resolveReaderMode, type ReaderMode } from "@/lib/reader-mode";
import { resolveReaderLayout } from "@/lib/reader-layout";
import { flattenToc, quoteTargetHref } from "@/lib/toc-items";
import { useReaderTts } from "@/lib/use-reader-tts";
import { isFindShortcut } from "@/lib/reader-paging";
import { FinishBookPrompt } from "@/components/FinishBookPrompt";
import { KosyncPrompt } from "@/components/KosyncPrompt";
import { UpdateBanner } from "@/components/UpdateBanner";
import { useAutoUpdateCheck } from "@/lib/app-update";

function PersistenceErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const { t } = useT();
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="min-w-0 flex-1">{t("reader.persistFailed", { message })}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t("common.close")}
      </Button>
    </div>
  );
}

function SyncFailureBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const { t } = useT();
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
    >
      <span className="min-w-0 flex-1">{t("sync.failureNotice", { message })}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        {t("common.close")}
      </Button>
    </div>
  );
}

/** The side panel floats this far in from its cell's edges (Tailwind `2`). */
const SIDE_PANEL_INSET_PX = 8;

function App() {
  const { t } = useT();
  const titlebarDrag = useTitlebarWindowDrag();
  const syncScheduler = useSyncScheduler();
  useAutoUpdateCheck();
  const [view, setView] = useState<"library" | "reader">("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [readerMode, setReaderMode] = useState<ReaderMode>("reader");
  const [sessionRailOpen, setSessionRailOpen] = useState(true);
  const [bookCollapsed, setBookCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(loadChatPanelWidth);
  const [agentBookWidth, setAgentBookWidth] = useState(loadAgentBookWidth);
  // Contents and Annotations share one side panel, switched by tab.
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<ReaderSidePanelTab>("toc");
  // Agent mode: the chapter picked from the TOC as the discussion scope. It
  // overrides the Book pane's position as the prompt's chapter context.
  const [chapterScope, setChapterScope] = useState<{ href: string; label: string } | null>(null);
  // Agent mode in a Guided session: its steps, and the TOC progress they make.
  const [guideSteps, setGuideSteps] = useState<GuideStep[] | null>(null);
  const [guideProgress, setGuideProgress] = useState<Record<string, GuideChapterProgress> | undefined>(undefined);
  const [tocWidth, setTocWidth] = useState(loadTocWidth);
  // Bumped by Ctrl/⌘+F so the search field takes focus even when already open.
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const session = useReaderSession({
    onOpened: (context) => {
      setChapterScope(null);
      setReaderMode(resolveReaderMode(context.lastReaderMode));
      const layout = resolveReaderLayout(context.lastLayout);
      setChatCollapsed(layout.chatCollapsed);
      setSessionRailOpen(layout.sessionRailOpen);
      setBookCollapsed(layout.bookCollapsed);
      setView("reader");
    },
  });
  const {
    readerRef,
    fileData,
    currentBook,
    bookTitle,
    progress,
    chapterLabel,
    chapterNav,
    chapterTicks,
    readerHistory,
    annotations,
    toc,
    tocExpanded,
    styleState,
    globalTheme,
    flushReadingState,
    reportPersistenceError,
    schedulePersistLayout,
    goToChapterHref,
    bookSearch,
    readingStatus,
    kosync,
  } = session;
  const bookImport = useBookImport();
  const bookHidden = readerMode === "agent" && bookCollapsed;
  const tts = useReaderTts({
    readerRef,
    bookHidden,
    fileKey: fileData?.bookId ?? null,
  });
  const chatRef = useRef<ChatPanelHandle>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const sidePanelRef = useRef<HTMLDivElement>(null);
  const tocResizeRef = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(
    null,
  );
  const paneResizeRef = useRef<{
    startX: number;
    startSize: number;
    containerWidth: number;
  } | null>(null);
  const tocWidthRef = useRef(tocWidth);
  tocWidthRef.current = tocWidth;
  const pendingCaptureRef = useRef<SelectionCapture | null>(null);
  const pendingQuoteRef = useRef<{ href: string; quote: string } | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closingRef.current) return;
        closingRef.current = true;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            flushReadingState().then(() => "flushed" as const),
            new Promise<"timeout">((resolve) => {
              timeout = setTimeout(() => resolve("timeout"), 2_000);
            }),
          ]);
          if (outcome === "timeout") {
            console.warn("Timed out while flushing reading state before close");
          }
        } catch (error) {
          reportPersistenceError(error);
          closingRef.current = false;
          return;
        } finally {
          if (timeout) clearTimeout(timeout);
        }
        // Push what changed since the last pass (the debounced push may not
        // have fired yet), or the next device opened would start from stale
        // reading positions. Never blocks closing for long.
        await pushBeforeLeaving(kosync.flush);
        try {
          embeddedAgentRuntime.closeBook();
          await getCurrentWindow().destroy();
        } catch (error) {
          reportPersistenceError(error);
          closingRef.current = false;
        }
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => console.error("Failed to register close handler:", error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flushReadingState, kosync.flush, reportPersistenceError]);

  // Android tablets get this shell too: there the app never closes, it goes
  // to the background, so that's when pending changes are pushed.
  usePlatformLifecycle({
    flush: flushReadingState,
    flushKosync: kosync.flush,
    syncOnReturn: syncScheduler.syncOnReturn,
  });

  // Escape closes overlay drawers. Page turning lives in ReaderView
  // (chapter iframe + host); do not handle ArrowLeft/ArrowRight here.
  useEffect(() => {
    if (view !== "reader" || !sidePanelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // The panel's own fields (search) have nothing to undo with Esc.
      const inPanel = sidePanelRef.current?.contains(target) ?? false;
      if (
        !inPanel &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        setSidePanelOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, sidePanelOpen]);

  // A persisted width may exceed the current reader container (e.g. the window
  // was resized smaller since the width was saved); clamp it back on open so
  // the drawer and its resize handle never leave the container.
  useEffect(() => {
    if (!sidePanelOpen) return;
    const container = sidePanelRef.current?.parentElement;
    const containerWidth = container?.getBoundingClientRect().width;
    const maxWidth =
      containerWidth == null ? undefined : containerWidth - 2 * SIDE_PANEL_INSET_PX;
    if (maxWidth != null && maxWidth > 0 && tocWidthRef.current > maxWidth) {
      setTocWidth(clampTocWidth(tocWidthRef.current, maxWidth));
    }
  }, [sidePanelOpen]);

  const handleOpenBook = session.openBook;

  useOpenPaths({
    importPaths: (paths) => bookImport.importFromPaths(paths, { suppressDuplicateNotice: true }),
    openBook: handleOpenBook,
    onError: (error) => {
      console.error("open-paths error:", error);
      bookImport.pushNotice({
        kind: "error",
        message: t("reader.openFileFailed", { message: invokeErrorMessage(error) }),
      });
    },
  });

  // "Open with" and shares on Android tablets (a no-op on desktop).
  useIncomingBooks({
    importIncoming: (books) => bookImport.importIncoming(books, { suppressDuplicateNotice: true }),
    openBook: handleOpenBook,
  });

  const handleBackToLibrary = useCallback(async () => {
    if (!(await session.closeBook())) return;
    tts.stop();
    setView("library");
    setChapterScope(null);
    setSidePanelOpen(false);
    setSidePanelTab("toc");
    setReaderMode("reader");
    setChatCollapsed(true);
    setSessionRailOpen(true);
    setBookCollapsed(false);
  }, [session.closeBook, tts.stop]);

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    if (readerMode === "agent") {
      if (bookCollapsed) return;
      chatRef.current?.fillInput(capture.text, capture.chapterHref);
      return;
    }
    if (chatCollapsed) {
      pendingCaptureRef.current = capture;
      setChatCollapsed(false);
      schedulePersistLayout({
        chatCollapsed: false,
        bookCollapsed,
        sessionRailOpen,
      });
      return;
    }
    if (chatRef.current) {
      chatRef.current.fillInput(capture.text, capture.chapterHref);
    } else {
      pendingCaptureRef.current = capture;
    }
  }, [bookCollapsed, chatCollapsed, readerMode, schedulePersistLayout, sessionRailOpen]);

  const handleReaderModeChange = useCallback(
    (mode: ReaderMode) => {
      setReaderMode(mode);
      session.rememberReaderMode(mode);
    },
    [session.rememberReaderMode],
  );

  useLayoutEffect(() => {
    if (chatCollapsed) return;
    const pending = pendingCaptureRef.current;
    if (!pending) return;
    pendingCaptureRef.current = null;
    chatRef.current?.fillInput(pending.text, pending.chapterHref);
  }, [chatCollapsed]);

  const handleCloseSettings = useCallback(async () => {
    try {
      await flushReadingState();
    } catch {
      return;
    }
    setSettingsOpen(false);
  }, [flushReadingState]);

  const handleTocGoTo = useCallback((href: string) => {
    if (readerMode === "agent") {
      const label = flattenToc(toc).find((item) => item.href === href)?.label ?? href;
      setChapterScope({ href, label });
      if (!bookCollapsed) goToChapterHref(href);
    } else {
      goToChapterHref(href);
    }
    setSidePanelOpen(false);
  }, [bookCollapsed, goToChapterHref, readerMode, toc]);

  const guideTocHrefs = useMemo(
    () => flattenToc(toc).map((item) => item.href).filter(Boolean),
    [toc],
  );
  useEffect(() => {
    if (readerMode !== "agent" || !guideSteps?.length) {
      setGuideProgress(undefined);
      return;
    }
    let cancelled = false;
    embeddedAgentRuntime.guideTocProgress(guideSteps, guideTocHrefs)
      .then((next) => { if (!cancelled) setGuideProgress(next); })
      .catch((error) => console.error("guide progress error:", error));
    return () => { cancelled = true; };
  }, [guideSteps, guideTocHrefs, readerMode]);

  // A Citation's "Open in Book": reveal a collapsed Agent-mode Book pane
  // first, then jump once it is visible.
  const handleOpenQuote = useCallback(
    (location: QuoteLocation, quote: string) => {
      const target = location.href;
      if (!target) return;
      const href = quoteTargetHref(toc, target);
      if (readerMode === "agent" && bookCollapsed) {
        pendingQuoteRef.current = { href, quote };
        setBookCollapsed(false);
        schedulePersistLayout({ chatCollapsed, bookCollapsed: false, sessionRailOpen });
        return;
      }
      void readerRef.current?.goToQuote(href, quote);
    },
    [bookCollapsed, chatCollapsed, readerMode, readerRef, schedulePersistLayout, sessionRailOpen, toc],
  );

  useEffect(() => {
    if (bookCollapsed) return;
    const pending = pendingQuoteRef.current;
    if (!pending) return;
    pendingQuoteRef.current = null;
    // Let the pane lay out before foliate navigates inside it.
    const frame = requestAnimationFrame(() => {
      void readerRef.current?.goToQuote(pending.href, pending.quote);
    });
    return () => cancelAnimationFrame(frame);
  }, [bookCollapsed, readerRef]);

  const startTocResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const drawer = sidePanelRef.current;
    if (!drawer) return;
    const container = drawer.parentElement;
    const maxWidth =
      (container?.getBoundingClientRect().width ?? window.innerWidth) - 2 * SIDE_PANEL_INSET_PX;
    tocResizeRef.current = {
      startX: e.clientX,
      startWidth: drawer.getBoundingClientRect().width,
      maxWidth,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onTocResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = tocResizeRef.current;
    if (!state) return;
    setTocWidth(clampTocWidth(state.startWidth + (e.clientX - state.startX), state.maxWidth));
  }, []);

  const endTocResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = tocResizeRef.current;
    if (!state) return;
    tocResizeRef.current = null;
    const next = clampTocWidth(state.startWidth + (e.clientX - state.startX), state.maxWidth);
    setTocWidth(next);
    saveTocWidth(next);
  }, []);

  const cancelTocResize = useCallback(() => {
    tocResizeRef.current = null;
  }, []);

  const startPaneResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = shellRef.current;
    if (!container) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth <= 0) return;
    paneResizeRef.current = {
      startX: e.clientX,
      startSize: readerMode === "reader" ? chatWidth : agentBookWidth,
      containerWidth,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [agentBookWidth, chatWidth, readerMode]);

  const onPaneResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = paneResizeRef.current;
    if (!state) return;
    const next =
      state.startSize + ((state.startX - e.clientX) / state.containerWidth) * 100;
    if (readerMode === "reader") setChatWidth(clampChatPanelWidth(next));
    else setAgentBookWidth(clampAgentBookWidth(next));
  }, [readerMode]);

  const endPaneResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = paneResizeRef.current;
    if (!state) return;
    paneResizeRef.current = null;
    const next =
      state.startSize + ((state.startX - e.clientX) / state.containerWidth) * 100;
    if (readerMode === "reader") {
      const width = clampChatPanelWidth(next);
      setChatWidth(width);
      saveChatPanelWidth(width);
    } else {
      const width = clampAgentBookWidth(next);
      setAgentBookWidth(width);
      saveAgentBookWidth(width);
    }
  }, [readerMode]);

  const cancelPaneResize = useCallback(() => {
    paneResizeRef.current = null;
  }, []);

  const jumpToAnnotation = useCallback(async (cfi: string, fraction?: number) => {
    await session.jumpToCfi(cfi, fraction);
    setSidePanelOpen(false);
  }, [session.jumpToCfi]);

  const handleJumpBookmark = useCallback(
    (bookmark: BookmarkRecord) => {
      void jumpToAnnotation(bookmark.cfi, bookmark.fraction);
    },
    [jumpToAnnotation],
  );

  const handleJumpHighlight = useCallback(
    (highlight: HighlightRecord) => {
      void jumpToAnnotation(highlight.cfi);
    },
    [jumpToAnnotation],
  );

  const sideCollapsed = readerMode === "reader" ? chatCollapsed : bookCollapsed;
  const sideWidth = readerMode === "reader" ? chatWidth : agentBookWidth;
  const chatHidden = readerMode === "reader" && chatCollapsed;
  const editingBook = view === "reader" && session.editingBook;
  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onClose={() => void handleCloseSettings()}
      bookTitle={editingBook ? bookTitle || null : null}
      hasBook={editingBook}
      styleState={styleState}
      onTypographyChange={session.handleTypographyChange}
      onRestoreDefault={session.handleRestoreDefault}
      overriddenKeys={editingBook ? session.overriddenKeys : []}
      theme={globalTheme}
      onThemeChange={session.setGlobalTheme}
      onReaderFlowChange={session.setReaderFlow}
      beforeUpdateRestart={flushReadingState}
    />
  );

  // Reading mode: the side panel is a drawer over the Book. Agent mode: it
  // opens over the Session, so picking a chapter never needs the Book pane.
  const tocCurrentHref =
    readerMode === "agent" ? chapterScope?.href ?? progress.chapterHref : progress.chapterHref;
  // Annotations jump the Book, so showing them reveals a collapsed Book pane.
  const revealBookForAnnotations = () => {
    if (!bookCollapsed) return;
    setBookCollapsed(false);
    schedulePersistLayout({
      chatCollapsed,
      bookCollapsed: false,
      sessionRailOpen,
    });
  };
  const handleSidePanelTabChange = (tab: ReaderSidePanelTab) => {
    setSidePanelTab(tab);
    if (tab !== "toc") revealBookForAnnotations();
  };
  const openBookSearch = () => {
    setSidePanelTab("search");
    setSidePanelOpen(true);
    setSearchFocusToken((n) => n + 1);
    revealBookForAnnotations();
  };
  const openBookSearchRef = useRef(openBookSearch);
  openBookSearchRef.current = openBookSearch;

  // Ctrl/⌘+F finds in the open Book. Keys typed inside the chapter never
  // reach the window; ReaderView forwards those through onFindRequest.
  useEffect(() => {
    if (view !== "reader") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isFindShortcut(e)) return;
      // Another dialog (settings) owns the keyboard while it is open.
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      e.preventDefault();
      openBookSearchRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view]);

  const sidePanel = sidePanelOpen ? (
    <>
      {/* Clicking outside closes the panel; the book stays fully legible. */}
      <button
        type="button"
        className="absolute inset-0 z-20 cursor-default"
        aria-label={
          sidePanelTab === "toc"
            ? t("reader.closeToc")
            : sidePanelTab === "search"
              ? t("search.close")
              : t("reader.closeAnnotations")
        }
        onClick={() => setSidePanelOpen(false)}
      />
      <div
        ref={sidePanelRef}
        className="reader-drawer-in absolute inset-y-2 left-2 z-30 overflow-hidden rounded-xl border bg-card shadow-float"
        style={{ width: tocWidth }}
      >
        <ReaderSidePanel
          tab={sidePanelTab}
          onTabChange={handleSidePanelTabChange}
          actions={
            sidePanelTab === "toc" ? (
              <TocSidebarActions
                onExpandAll={session.handleTocExpandAll}
                onCollapseAll={session.handleTocCollapseAll}
              />
            ) : null
          }
        >
          {sidePanelTab === "toc" ? (
            <TocSidebar
              toc={toc}
              currentHref={tocCurrentHref}
              expanded={tocExpanded}
              onToggle={session.handleTocToggle}
              onGoTo={handleTocGoTo}
              guideProgress={guideProgress}
            />
          ) : sidePanelTab === "search" ? (
            <BookSearchPanel
              query={bookSearch.query}
              onQueryChange={bookSearch.setQuery}
              onSubmit={bookSearch.submit}
              onStep={bookSearch.step}
              onSelect={bookSearch.select}
              onClear={bookSearch.reset}
              results={bookSearch.results}
              status={bookSearch.status}
              activeCfi={bookSearch.activeCfi}
              focusToken={searchFocusToken}
            />
          ) : (
            <AnnotationsSidebar
              bookmarks={annotations.bookmarks}
              highlights={annotations.highlights}
              onAddBookmark={session.handleAddBookmark}
              onJumpBookmark={handleJumpBookmark}
              onDeleteBookmark={session.handleDeleteBookmark}
              onJumpHighlight={handleJumpHighlight}
              onDeleteHighlight={session.handleDeleteHighlight}
            />
          )}
        </ReaderSidePanel>
      </div>
      <div
        className="absolute inset-y-2 z-40 w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/30"
        style={{ left: SIDE_PANEL_INSET_PX + tocWidth - 3 }}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startTocResize}
        onPointerMove={onTocResizeMove}
        onPointerUp={endTocResize}
        onPointerCancel={cancelTocResize}
      />
    </>
  ) : null;

  const sidePanelButton = (
    <Button
      size="icon-sm"
      variant={sidePanelOpen ? "secondary" : "ghost"}
      onClick={() => {
        const next = !sidePanelOpen;
        setSidePanelOpen(next);
        if (next && sidePanelTab !== "toc") revealBookForAnnotations();
      }}
      aria-label={t("reader.sidePanel")}
      aria-expanded={sidePanelOpen}
    >
      <List />
    </Button>
  );

  if (view === "library") {
    return (
      <main className="flex h-screen flex-col bg-background text-foreground">
        <PersistenceErrorBanner
          message={session.persistenceError}
          onDismiss={session.clearPersistenceError}
        />
        <SyncFailureBanner
          message={syncScheduler.persistentFailure}
          onDismiss={syncScheduler.clearPersistentFailure}
        />
        <UpdateBanner beforeRestart={flushReadingState} />
        <BookImportNotices
          notices={bookImport.notices}
          dismissNotice={bookImport.dismissNotice}
          onOpenBook={handleOpenBook}
          actionDisabled={bookImport.importing}
        />
        <LibraryView
          onOpenBook={handleOpenBook}
          openingBookId={session.openingBookId}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {settingsDialog}
        <BookImportConfirmDialog
          confirmOpen={bookImport.confirmOpen}
          confirmRequest={bookImport.confirmRequest}
          settleConfirm={bookImport.settleConfirm}
        />
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <PersistenceErrorBanner
        message={session.persistenceError}
        onDismiss={session.clearPersistenceError}
      />
      <SyncFailureBanner
        message={syncScheduler.persistentFailure}
        onDismiss={syncScheduler.clearPersistentFailure}
      />
      <UpdateBanner beforeRestart={flushReadingState} />
      <BookImportNotices
        notices={bookImport.notices}
        dismissNotice={bookImport.dismissNotice}
        onOpenBook={handleOpenBook}
        actionDisabled={bookImport.importing}
      />
      {/* Top toolbar: no rule underneath, tone and space separate it. */}
      <header className={titlebarClassName({ bordered: false })}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void handleBackToLibrary()}
          aria-label={t("reader.backToLibrary")}
        >
          <ChevronLeft />
        </Button>
        {readerMode === "reader" ? sidePanelButton : null}
        {readerMode === "agent" && (
          <Button
            size="icon-sm"
            variant={sessionRailOpen ? "secondary" : "ghost"}
            onClick={() => {
              const next = !sessionRailOpen;
              setSessionRailOpen(next);
              schedulePersistLayout({
                chatCollapsed,
                bookCollapsed,
                sessionRailOpen: next,
              });
            }}
            aria-label={t("chat.sessions")}
            aria-pressed={sessionRailOpen}
          >
            <PanelLeft />
          </Button>
        )}
        <h1
          className="min-w-0 shrink truncate select-none text-sm font-medium"
          title={bookTitle}
          data-titlebar-drag
          {...titlebarDrag}
        >
          {shortBookTitle(bookTitle)}
        </h1>
        <div
          className="min-h-0 min-w-0 flex-1 select-none self-stretch"
          data-titlebar-drag
          {...titlebarDrag}
        />
        <div className="flex items-center gap-1">
          {/* Read-aloud reads the Book pane; with the pane hidden in Agent
              mode it has nothing to read, so it steps aside. */}
          {!(readerMode === "agent" && bookHidden) && (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={bookHidden}
              aria-label={
                tts.status === "playing" ? t("reader.ttsPause") : t("reader.ttsPlay")
              }
              onClick={() => tts.toggle()}
            >
              {tts.status === "playing" ? <Pause /> : <Volume2 />}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label={t("reader.fontAndTheme")}
          >
            <Type />
          </Button>
          {readerMode === "agent" ? sidePanelButton : null}
        </div>
        <div className="flex items-center gap-1">
          <div
            role="group"
            aria-label={t("reader.mode")}
            className="flex items-center gap-0.5"
          >
            {(["reader", "agent"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={readerMode === mode}
                onClick={() => {
                  if (readerMode !== mode) handleReaderModeChange(mode);
                }}
                className={cn(
                  "h-7 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring motion-reduce:transition-none",
                  readerMode === mode
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(mode === "reader" ? "settings.defaultMode.reader" : "settings.defaultMode.agent")}
              </button>
            ))}
          </div>
          {readerMode === "reader" ? (
            <Button
              size="icon-sm"
              variant={chatCollapsed ? "ghost" : "secondary"}
              onClick={() => {
                const next = !chatCollapsed;
                setChatCollapsed(next);
                schedulePersistLayout({
                  chatCollapsed: next,
                  bookCollapsed,
                  sessionRailOpen,
                });
              }}
              aria-label={chatCollapsed ? t("reader.showChat") : t("reader.hideChat")}
            >
              <MessageSquare />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant={bookCollapsed ? "ghost" : "secondary"}
              onClick={() => {
                const next = !bookCollapsed;
                setBookCollapsed(next);
                schedulePersistLayout({
                  chatCollapsed,
                  bookCollapsed: next,
                  sessionRailOpen,
                });
              }}
              aria-label={bookCollapsed ? t("reader.showBook") : t("reader.hideBook")}
            >
              <BookText />
            </Button>
          )}
        </div>
        <WindowControls />
      </header>

      {/* Same two cells; mode only swaps grid-template-areas. */}
      <div
        ref={shellRef}
        data-testid="reader-shell"
        className="relative grid flex-1 overflow-hidden"
        style={{
          gridTemplateAreas: readerMode === "reader" ? '"book chat"' : '"chat book"',
          gridTemplateColumns: sideCollapsed ? "1fr 0px" : `1fr ${sideWidth}%`,
        }}
      >
        <div
          data-testid="reader-book-cell"
          hidden={bookHidden}
          className={
            bookHidden
              ? "min-h-0 min-w-0 flex-col overflow-hidden"
              : readerMode === "agent"
                ? // Mirrors the docked chat in reading mode: beside the Session
                  // workspace, the Book floats as a card instead of a ruled pane.
                  "relative my-2 mr-2 ml-1 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-soft"
                : "relative flex min-h-0 min-w-0 flex-col overflow-hidden"
          }
          style={{ gridArea: "book" }}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden">
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
                onTtsToggle={tts.toggle}
                ttsActive={tts.status !== "idle"}
                onHistoryChange={session.setReaderHistory}
                onFindRequest={() => openBookSearchRef.current()}
                keysDisabled={bookHidden}
                onUserRelocate={tts.onUserRelocate}
                stylesCss={session.stylesCss}
              />
            )}
            {kosync.prompt && (
              <KosyncPrompt
                prompt={kosync.prompt}
                onJump={kosync.accept}
                onStay={kosync.dismiss}
              />
            )}
            {readingStatus.finishPromptOpen && (
              <FinishBookPrompt
                onMarkFinished={() => void readingStatus.markFinished()}
                onDismiss={readingStatus.dismissFinishPrompt}
              />
            )}
            {readerMode === "reader" && sidePanel}
          </div>
          {tts.error ? (
            <div
              role="alert"
              className="mx-2 mb-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            >
              {tts.error}
            </div>
          ) : null}
          {tts.status !== "idle" ? (
            <ReaderTtsBar
              playing={tts.status === "playing"}
              rate={tts.rate}
              voiceURI={tts.voiceURI}
              voices={tts.voices}
              onPause={tts.pause}
              onPlay={tts.play}
              onStop={tts.stop}
              onRate={tts.setRate}
              onVoice={tts.setVoice}
            />
          ) : null}
          <ReaderProgressBar
            fraction={progress.fraction}
            chapterLabel={chapterLabel}
            ticks={chapterTicks}
            onSeek={session.seekProgress}
            onPrevChapter={session.handlePrevChapter}
            onNextChapter={session.handleNextChapter}
            canPrevChapter={chapterNav.canPrev}
            canNextChapter={chapterNav.canNext}
            previewLabelAt={(frac) => readerRef.current?.previewLabelAt(frac)}
            canGoBack={readerHistory.canGoBack && !readerHistory.readOn}
            canGoForward={readerHistory.canGoForward && !readerHistory.readOn}
            onBack={() => readerRef.current?.goBack()}
            onForward={() => readerRef.current?.goForward()}
          />
        </div>
        <div
          data-testid="reader-chat-cell"
          hidden={chatHidden}
          className={
            !chatHidden && readerMode === "reader"
              ? "relative h-full min-h-0 min-w-0 overflow-hidden py-2 pr-2 pl-1"
              : "relative h-full min-h-0 min-w-0 overflow-hidden"
          }
          style={{ gridArea: "chat" }}
        >
          {readerMode === "agent" && sidePanel}
          {/* Docked beside the book, the assistant floats as a card; as the
              Agent-mode workspace it fills its cell edge to edge. */}
          <div
            data-testid="reader-chat-card"
            className={
              readerMode === "reader"
                ? "h-full overflow-hidden rounded-xl border bg-card shadow-soft"
                : "h-full"
            }
          >
            <ChatPanel
              ref={chatRef}
              currentChapterHref={
                readerMode === "agent" ? chapterScope?.href ?? progress.chapterHref : progress.chapterHref
              }
              chapterScope={readerMode === "agent" ? chapterScope : null}
              onClearChapterScope={() => setChapterScope(null)}
              onOpenQuote={handleOpenQuote}
              bookId={fileData?.bookId ?? ""}
              variant={readerMode === "agent" ? "workspace" : "docked"}
              sessionRailOpen={sessionRailOpen}
              preferGuidedSession={readerMode === "agent"}
              onGuideStepsChange={setGuideSteps}
            />
          </div>
        </div>
        {!sideCollapsed && (
          <div
            className="absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/30"
            style={{ left: `calc(100% - ${sideWidth}% - 3px)` }}
            role="separator"
            aria-orientation="vertical"
            aria-label={
              readerMode === "reader" ? t("reader.resizeChat") : t("reader.resizeBook")
            }
            onPointerDown={startPaneResize}
            onPointerMove={onPaneResizeMove}
            onPointerUp={endPaneResize}
            onPointerCancel={cancelPaneResize}
          />
        )}
      </div>
      {settingsDialog}
      <BookImportConfirmDialog
        confirmOpen={bookImport.confirmOpen}
        confirmRequest={bookImport.confirmRequest}
        settleConfirm={bookImport.settleConfirm}
      />
    </main>
  );
}

export default App;
