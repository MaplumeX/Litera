import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ChevronLeft, List, Type, MessageSquare, MessageSquareOff } from "lucide-react";
import {
  ReaderView,
  type ReaderViewHandle,
  type SelectionCapture,
  type TocItem,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { LibraryView } from "@/components/LibraryView";
import { TocSidebar } from "@/components/TocSidebar";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  generateStylesCss,
  normalizeSettings,
  type ReaderStyleState,
} from "@/lib/reader-styles";
import { usePreferences, themeToClassName, syncStyleTheme } from "@/lib/preferences";
import type { BookOpenContext, BookRecord } from "@/types/library";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { invokeErrorMessage } from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";
import { createLatestSerializedTaskController } from "@/lib/latest-serialized-task";

interface FileData {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  bookId: string;
}

function ReaderProgressBar({
  fraction,
  chapterLabel,
}: {
  fraction: number;
  chapterLabel: string;
}) {
  const pct = Math.round(fraction * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-24 rounded bg-muted">
        <div
          className="h-full rounded bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {chapterLabel} · {pct}%
      </span>
    </div>
  );
}

function PersistenceErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <span className="min-w-0 flex-1">阅读状态保存失败：{message}</span>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        关闭
      </Button>
    </div>
  );
}

function App() {
  const [view, setView] = useState<"library" | "reader">("library");
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
  const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({
    index: 0,
    fraction: 0,
  });
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [tocVisible, setTocVisible] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const [styleState, setStyleState] = useState<ReaderStyleState>({
    fontSize: 16,
    fontFamily: "serif",
    theme: "light",
  });
  const { theme: globalTheme, setTheme: setGlobalTheme, flush: flushPreferences } = usePreferences();
  const readerRef = useRef<ReaderViewHandle>(null);
  const chatRef = useRef<ChatPanelHandle>(null);
  const closingRef = useRef(false);
  const openBookControllerRef = useRef(createLatestSerializedTaskController());
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

  // Persist reading settings (debounced) — only fontSize/fontFamily per book.
  const persistSettings = useDebouncedCallback(
    async (bookId: string, state: ReaderStyleState) => {
      await invoke("update_reading_state", {
        bookId,
        settings: {
          fontSize: state.fontSize,
          fontFamily: state.fontFamily,
        },
      });
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

  // Sync styleState.theme with globalTheme whenever globalTheme changes.
  useEffect(() => {
    setStyleState((prev) => syncStyleTheme(prev, globalTheme));
  }, [globalTheme]);

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

  // Keyboard page navigation (reader view only).
  useEffect(() => {
    if (view !== "reader" || !fileData) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        void readerRef.current?.prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        void readerRef.current?.next();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, fileData]);

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
      setCurrentBook({
        id: context.bookId,
        title: "",
        author: "",
        coverPath: "",
        filePath: "",
        importedAt: "",
        lastFraction: context.lastFraction,
        settings: context.settings,
      });

      // Initialize style state from saved settings (theme comes from global preferences).
      setStyleState({
        ...normalizeSettings(context.settings),
        theme: globalTheme,
      });

      setView("reader");
    } catch (err) {
      console.error("open_book_bytes error:", err);
      alert(`打开书籍失败: ${invokeErrorMessage(err)}`);
    } finally {
      if (request.isLatest()) setOpeningBookId(null);
    }
  }, [flushReadingState, globalTheme]);

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
        alert(`关闭阅读助手失败: ${invokeErrorMessage(error)}`);
        return;
      }
    }
    setView("library");
    setFileData(null);
    setCurrentBook(null);
    setToc([]);
    setTocVisible(false);
    setSettingsOpen(false);
  }, [fileData?.bookId, flushReadingState]);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string) => {
      setProgress({ index, fraction, label });
      // Persist reading position.
      if (fileData?.bookId) {
        persistFraction.schedule(fileData.bookId, fraction);
      }
    },
    [fileData?.bookId, persistFraction],
  );

  const handleSelectionCapture = useCallback((capture: SelectionCapture) => {
    chatRef.current?.fillInput(capture.text, capture.chapterIndex);
  }, []);

  const handleBookReady = useCallback((bookToc: TocItem[]) => {
    setToc(bookToc);
    // Apply saved styles now that the renderer exists.
    readerRef.current?.setStyles(generateStylesCss(styleStateRef.current));
  }, []);

  const handleStyleChange = useCallback(
    (state: ReaderStyleState) => {
      // Theme is global — route through setGlobalTheme instead of per-book persist.
      if (state.theme !== globalTheme) {
        setGlobalTheme(state.theme);
      }
      const fontSizeChanged = state.fontSize !== styleStateRef.current.fontSize;
      const fontFamilyChanged = state.fontFamily !== styleStateRef.current.fontFamily;
      setStyleState(state);
      if (fileData?.bookId && (fontSizeChanged || fontFamilyChanged)) {
        persistSettings.schedule(fileData.bookId, state);
      }
    },
    [fileData?.bookId, persistSettings, globalTheme, setGlobalTheme],
  );

  const handleGlobalThemeChange = useCallback(
    (newTheme: string) => {
      setGlobalTheme(newTheme);
    },
    [setGlobalTheme],
  );

  const handleTocGoTo = useCallback((href: string) => {
    readerRef.current?.goToTocItem(href);
  }, []);

  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;
  const bookTitle = currentBook?.title || fileData?.name || "";

  if (view === "library") {
    return (
      <main className="flex h-screen flex-col bg-background text-foreground">
        <PersistenceErrorBanner
          message={persistenceError}
          onDismiss={() => setPersistenceError(null)}
        />
        <LibraryView
          onOpenBook={handleOpenBook}
          openingBookId={openingBookId}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          styleState={styleState}
          onStyleChange={handleStyleChange}
          globalTheme={globalTheme}
          onThemeChange={handleGlobalThemeChange}
          hasBook={false}
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
      {/* Top toolbar */}
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void handleBackToLibrary()}
          aria-label="返回书库"
        >
          <ChevronLeft />
        </Button>
        <h1 className="text-lg font-bold">Litera</h1>
        {bookTitle && (
          <span className="truncate text-sm text-muted-foreground">{bookTitle}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* Progress bar */}
          <ReaderProgressBar fraction={progress.fraction} chapterLabel={chapterLabel} />
          {/* TOC toggle */}
          <Button
            size="icon-sm"
            variant={tocVisible ? "secondary" : "ghost"}
            onClick={() => setTocVisible((v) => !v)}
            aria-label="目录"
          >
            <List />
          </Button>
          {/* Font + theme controls (opens settings dialog) */}
          <Button
            size="icon-sm"
            variant={settingsOpen ? "secondary" : "ghost"}
            onClick={() => setSettingsOpen(true)}
            aria-label="字体与主题"
          >
            <Type />
          </Button>
          {/* Chat toggle */}
          <Button
            size="icon-sm"
            variant={chatCollapsed ? "outline" : "ghost"}
            onClick={() => setChatCollapsed((v) => !v)}
            aria-label={chatCollapsed ? "显示对话" : "隐藏对话"}
          >
            {chatCollapsed ? <MessageSquare /> : <MessageSquareOff />}
          </Button>
        </div>
      </header>

      {/* Reader + Chat panel split */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* TOC sidebar */}
        {tocVisible && (
          <div className="h-full w-56 shrink-0 overflow-y-auto border-r">
            <TocSidebar toc={toc} onGoTo={handleTocGoTo} />
          </div>
        )}

        {chatCollapsed ? (
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
          </div>
        ) : (
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize={65} minSize={30}>
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
              </div>
            </Panel>
            <Separator className="w-px bg-border hover:bg-primary/30 transition-colors cursor-col-resize" />
            <Panel defaultSize={35} minSize={20}>
              <ChatPanel ref={chatRef} currentChapterIndex={progress.index} bookId={fileData?.bookId ?? ""} />
            </Panel>
          </Group>
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        styleState={styleState}
        onStyleChange={handleStyleChange}
        globalTheme={globalTheme}
        onThemeChange={handleGlobalThemeChange}
        hasBook={true}
      />
    </main>
  );
}

export default App;
