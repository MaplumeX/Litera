import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ChevronLeft, List, Type, MessageSquare } from "lucide-react";
import {
  ReaderView,
  type ReaderViewHandle,
  type SelectionCapture,
  type TocItem,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { LibraryView } from "@/components/LibraryView";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { TocSidebar } from "@/components/TocSidebar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import {
  bookSettingsSnapshot,
  generateStylesCss,
  isTypographyOverridden,
  normalizeSettings,
  TYPOGRAPHY_KEYS,
  type TypographyKey,
} from "@/lib/reader-styles";
import { usePreferences, themeToClassName, type AppPreferences } from "@/lib/preferences";
import type { BookOpenContext, BookRecord, ReadingSettings } from "@/types/library";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { invokeErrorMessage } from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";
import { createLatestSerializedTaskController } from "@/lib/latest-serialized-task";
import { useBookImport } from "@/lib/use-book-import";
import { useOpenPaths } from "@/lib/use-open-paths";
import { useT } from "@/lib/i18n";

interface FileData {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  bookId: string;
}

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

function App() {
  const { t } = useT();
  const [view, setView] = useState<"library" | "reader">("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
  const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({
    index: 0,
    fraction: 0,
  });
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [tocVisible, setTocVisible] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const {
    theme: globalTheme,
    setTheme: setGlobalTheme,
    preferences,
    updatePreferences,
    flush: flushPreferences,
  } = usePreferences();
  const styleState = useMemo(
    () => normalizeSettings(currentBook?.settings, preferences),
    [currentBook?.settings, preferences],
  );
  const bookImport = useBookImport();
  const readerRef = useRef<ReaderViewHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);
  const chatPanelRef = usePanelRef();
  const pendingCaptureRef = useRef<SelectionCapture | null>(null);
  const closingRef = useRef(false);
  const openBookControllerRef = useRef(createLatestSerializedTaskController());
  // Latest fraction for open-book / relocate; do not write it into currentBook
  // on every relocate or ReaderView's [fileData, initialFraction] effect re-opens.
  const lastKnownFractionRef = useRef<number | undefined>(undefined);
  // Track latest style state so handleBookReady can apply it after renderer mounts.
  const styleStateRef = useRef(styleState);
  styleStateRef.current = styleState;

  const reportPersistenceError = useCallback((error: unknown) => {
    console.error("Failed to persist reading state:", error);
    setPersistenceError(invokeErrorMessage(error));
  }, []);

  // Persist reading position (debounced).
  const persistFraction = useDebouncedCallback(
    async (bookId: string, fraction: number) => {
      await invoke("update_reading_state", { bookId, lastFraction: fraction });
    },
    500,
    reportPersistenceError,
  );

  // Persist the full per-book settings snapshot (replace, not merge).
  const persistSettings = useDebouncedCallback(
    async (bookId: string, settings: ReadingSettings) => {
      await invoke("update_reading_state", { bookId, settings });
    },
    500,
    reportPersistenceError,
  );

  const flushReadingState = useCallback(
    async () => {
      try {
        await Promise.all([persistFraction.flush(), persistSettings.flush(), flushPreferences()]);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [persistFraction, persistSettings, reportPersistenceError, flushPreferences],
  );

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
        try {
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
  }, [flushReadingState, reportPersistenceError]);

  // Apply theme class to <html> so CSS variables cascade to portaled dialogs.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "sepia");
    const cls = themeToClassName(globalTheme);
    if (cls) root.classList.add(cls);
  }, [globalTheme]);

  // Apply styles + persist whenever style state changes.
  useEffect(() => {
    const css = generateStylesCss(styleState);
    readerRef.current?.setStyles(css);
  }, [styleState]);

  // Escape closes the TOC overlay. Page turning lives in ReaderView
  // (chapter iframe + host); do not handle ArrowLeft/ArrowRight here.
  useEffect(() => {
    if (view !== "reader" || !tocVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        setTocVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, tocVisible]);

  const handleOpenBook = useCallback(async (bookId: string) => {
    // `open_book_bytes` also switches the sidecar, so it is intentionally
    // serialized. A later click supersedes the older UI result without letting
    // two side-effecting opens complete out of order.
    const request = openBookControllerRef.current.run(async () => {
      await flushReadingState();
      const context = await invoke<BookOpenContext>("get_book_open_context", { bookId });
      const buffer = await invoke<ArrayBuffer>("open_book_bytes", {
        bookId,
        contentVersion: context.contentVersion,
      });
      return { context, buffer };
    });
    setOpeningBookId(bookId);
    try {
      const result = await request.promise;
      if (result.status === "stale") return;
      const { context, buffer } = result.value;
      setFileData({
        bytes: epubBytesFromIpc(buffer),
        name: context.name,
        bookId: context.bookId,
      });

      // Build a partial BookRecord for passing lastFraction + settings to ReaderView.
      // The full record is fetched from list_books; this context stays lightweight.
      lastKnownFractionRef.current = context.lastFraction;
      setCurrentBook({
        id: context.bookId,
        title: context.title,
        author: "",
        coverPath: "",
        filePath: "",
        importedAt: "",
        lastFraction: context.lastFraction,
        settings: context.settings,
      });

      setView("reader");
    } catch (err) {
      console.error("open_book_bytes error:", err);
      alert(t("reader.openFailed", { message: invokeErrorMessage(err) }));
    } finally {
      if (request.isLatest()) setOpeningBookId(null);
    }
  }, [flushReadingState]);

  useOpenPaths({
    importPaths: bookImport.importFromPaths,
    openBook: handleOpenBook,
    onError: (error) => {
      console.error("open-paths error:", error);
      bookImport.pushNotice({
        kind: "error",
        message: t("reader.openFileFailed", { message: invokeErrorMessage(error) }),
      });
    },
  });

  const handleBackToLibrary = useCallback(async () => {
    try {
      await flushReadingState();
    } catch {
      return;
    }
    const closingBookId = fileData?.bookId;
    if (closingBookId) {
      try {
        await invoke("close_book", {
          bookId: closingBookId,
          requestId: `close-book-${crypto.randomUUID()}`,
        });
      } catch (error) {
        console.error("close_book error:", error);
        alert(t("reader.closeAgentFailed", { message: invokeErrorMessage(error) }));
        return;
      }
    }
    setView("library");
    setFileData(null);
    setCurrentBook(null);
    setToc([]);
    setTocVisible(false);
  }, [fileData?.bookId, flushReadingState]);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string) => {
      lastKnownFractionRef.current = fraction;
      setProgress({ index, fraction, label });
      // Persist reading position.
      if (fileData?.bookId) {
        persistFraction.schedule(fileData.bookId, fraction);
      }
    },
    [fileData?.bookId, persistFraction],
  );

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    if (chatCollapsed) {
      pendingCaptureRef.current = capture;
      setChatCollapsed(false);
      return;
    }
    if (chatRef.current) {
      chatRef.current.fillInput(capture.text, capture.chapterIndex);
    } else {
      pendingCaptureRef.current = capture;
    }
  }, [chatCollapsed]);

  useLayoutEffect(() => {
    if (view !== "reader") return;
    const panel = chatPanelRef.current;
    if (!panel) return;
    if (chatCollapsed) {
      panel.collapse();
      return;
    }
    panel.expand();
    // First expand has no saved size, so the library opens at minSize (18).
    if (panel.isCollapsed() || panel.getSize().asPercentage <= 18) {
      panel.resize("22");
    }
  }, [view, chatCollapsed, chatPanelRef]);

  useLayoutEffect(() => {
    if (chatCollapsed) return;
    const pending = pendingCaptureRef.current;
    if (!pending) return;
    pendingCaptureRef.current = null;
    chatRef.current?.fillInput(pending.text, pending.chapterIndex);
  }, [chatCollapsed]);

  const handleBookReady = useCallback((bookToc: TocItem[]) => {
    setToc(bookToc);
    // Apply saved styles now that the renderer exists.
    readerRef.current?.setStyles(generateStylesCss(styleStateRef.current));
  }, []);

  const handleCloseSettings = useCallback(async () => {
    try {
      await flushReadingState();
    } catch {
      return;
    }
    setSettingsOpen(false);
  }, [flushReadingState]);

  const persistBookSnapshot = useCallback(
    (settings: ReadingSettings) => {
      const bookId = fileData?.bookId ?? currentBook?.id;
      if (!bookId) return;
      persistSettings.schedule(bookId, settings);
    },
    [currentBook?.id, fileData?.bookId, persistSettings],
  );

  const handleTypographyChange = useCallback(
    (key: TypographyKey, value: number | string) => {
      if (view === "reader") {
        if (!currentBook) return;
        const nextSettings = bookSettingsSnapshot(currentBook.settings, { [key]: value });
        setCurrentBook({
          ...currentBook,
          settings: Object.keys(nextSettings).length ? nextSettings : undefined,
        });
        persistBookSnapshot(nextSettings);
        return;
      }
      updatePreferences({ [key]: value } as Partial<AppPreferences>);
    },
    [currentBook, persistBookSnapshot, updatePreferences, view],
  );

  const handleRestoreDefault = useCallback(
    (key: TypographyKey) => {
      if (!currentBook) return;
      const nextSettings = bookSettingsSnapshot(currentBook.settings, undefined, key);
      setCurrentBook({
        ...currentBook,
        settings: Object.keys(nextSettings).length ? nextSettings : undefined,
      });
      persistBookSnapshot(nextSettings);
    },
    [currentBook, persistBookSnapshot],
  );

  const handleTocGoTo = useCallback((href: string) => {
    readerRef.current?.goToTocItem(href);
    setTocVisible(false);
  }, []);

  const bookTitle = currentBook?.title || fileData?.name || "";
  const editingBook = view === "reader" && Boolean(currentBook || fileData);
  const overriddenKeys: TypographyKey[] = editingBook
    ? TYPOGRAPHY_KEYS.filter((key) => isTypographyOverridden(currentBook?.settings, key))
    : [];
  const settingsDialog = (
    <SettingsDialog
      open={settingsOpen}
      onClose={() => void handleCloseSettings()}
      bookTitle={editingBook ? bookTitle || null : null}
      hasBook={editingBook}
      styleState={styleState}
      onTypographyChange={handleTypographyChange}
      onRestoreDefault={handleRestoreDefault}
      overriddenKeys={overriddenKeys}
      theme={globalTheme}
      onThemeChange={setGlobalTheme}
    />
  );

  if (view === "library") {
    return (
      <main className="flex h-screen flex-col bg-background text-foreground">
        <PersistenceErrorBanner
          message={persistenceError}
          onDismiss={() => setPersistenceError(null)}
        />
        <BookImportNotices
          notices={bookImport.notices}
          dismissNotice={bookImport.dismissNotice}
          onOpenBook={handleOpenBook}
          actionDisabled={bookImport.importing}
        />
        <LibraryView
          onOpenBook={handleOpenBook}
          openingBookId={openingBookId}
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
        message={persistenceError}
        onDismiss={() => setPersistenceError(null)}
      />
      <BookImportNotices
        notices={bookImport.notices}
        dismissNotice={bookImport.dismissNotice}
        onOpenBook={handleOpenBook}
        actionDisabled={bookImport.importing}
      />
      {/* Top toolbar */}
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void handleBackToLibrary()}
          aria-label={t("reader.backToLibrary")}
        >
          <ChevronLeft />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{bookTitle}</h1>
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant={tocVisible ? "secondary" : "ghost"}
            onClick={() => setTocVisible((v) => !v)}
            aria-label={t("reader.toc")}
          >
            <List />
          </Button>
          {/* Font + theme controls */}
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label={t("reader.fontAndTheme")}
          >
            <Type />
          </Button>
          <Button
            size="icon-sm"
            variant={chatCollapsed ? "ghost" : "secondary"}
            onClick={() => setChatCollapsed((v) => !v)}
            aria-label={chatCollapsed ? t("reader.showChat") : t("reader.hideChat")}
          >
            <MessageSquare />
          </Button>
        </div>
      </header>

      {/* Reader + Chat panel split */}
      <div className="relative flex flex-1 overflow-hidden">
        <Group
          orientation="horizontal"
          className="h-full w-full"
          defaultLayout={chatCollapsed ? { reader: 100, chat: 0 } : { reader: 78, chat: 22 }}
        >
          <Panel id="reader" defaultSize="78" minSize="40">
            <div className="relative h-full w-full overflow-hidden">
              {fileData && (
                <ReaderView
                  ref={readerRef}
                  fileData={fileData}
                  onRelocate={handleRelocate}
                  onSelectionCapture={handleSelectionCapture}
                  initialFraction={currentBook?.lastFraction}
                  onBookReady={handleBookReady}
                />
              )}
              {tocVisible && (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-20 bg-background/50"
                    aria-label={t("reader.closeToc")}
                    onClick={() => setTocVisible(false)}
                  />
                  <div className="absolute inset-y-0 left-0 z-30 w-56 overflow-hidden border-r bg-background shadow-md">
                    <TocSidebar toc={toc} onGoTo={handleTocGoTo} />
                  </div>
                </>
              )}
            </div>
          </Panel>
          <Separator
            className={
              chatCollapsed
                ? "hidden"
                : "w-px cursor-col-resize bg-border transition-colors hover:bg-primary/30"
            }
            disabled={chatCollapsed}
          />
          <Panel
            id="chat"
            defaultSize="22"
            minSize="18"
            collapsible
            collapsedSize="0"
            panelRef={chatPanelRef}
          >
            <div className={chatCollapsed ? "hidden h-full" : "h-full"}>
              <ChatPanel
                ref={chatRef}
                currentChapterIndex={progress.index}
                bookId={fileData?.bookId ?? ""}
              />
            </div>
          </Panel>
        </Group>
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
