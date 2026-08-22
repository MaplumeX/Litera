import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import {
  WindowControls,
  titlebarClassName,
  useTitlebarWindowDrag,
} from "@/components/WindowControls";
import {
  BookOpen,
  BookText,
  Bookmark,
  Bot,
  ChevronLeft,
  List,
  MessageSquare,
  Pause,
  Type,
  Volume2,
} from "lucide-react";
import {
  ReaderView,
  type ReaderViewHandle,
  type SelectionCapture,
  type SelectionCfi,
  type TocItem,
} from "@/components/ReaderView";
import { ChatPanel, type ChatPanelHandle } from "@/components/chat/ChatPanel";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import { LibraryView } from "@/components/LibraryView";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { ReaderProgressBar } from "@/components/ReaderProgressBar";
import { ReaderTtsBar } from "@/components/ReaderTtsBar";
import { TocSidebar } from "@/components/TocSidebar";
import { AnnotationsSidebar } from "@/components/AnnotationsSidebar";
import {
  appendBookmark,
  appendHighlight,
  createBookmark,
  createHighlight,
  emptyAnnotations,
  removeBookmark,
  removeHighlight,
  updateHighlight,
} from "@/lib/annotations";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import {
  bookSettingsSnapshot,
  generateStylesCss,
  isTypographyOverridden,
  normalizeSettings,
  TYPOGRAPHY_KEYS,
  type TypographyKey,
} from "@/lib/reader-styles";
import { usePreferences, resolveTheme, themeToClassName, type AppPreferences } from "@/lib/preferences";
import type {
  AnnotationsFile,
  BookOpenContext,
  BookmarkRecord,
  BookRecord,
  HighlightColor,
  HighlightRecord,
  ReaderLayout,
  ReadingSettings,
} from "@/types/library";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { invokeErrorMessage } from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";
import { createLatestSerializedTaskController } from "@/lib/latest-serialized-task";
import { useBookImport } from "@/lib/use-book-import";
import { useOpenPaths } from "@/lib/use-open-paths";
import { useT } from "@/lib/i18n";
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
import {
  isReaderMode,
  resolveReaderMode,
  type ReaderMode,
} from "@/lib/reader-mode";
import { isReaderLayout, resolveReaderLayout } from "@/lib/reader-layout";
import { chapterNavAt } from "@/lib/toc-items";
import { useReaderTts } from "@/lib/use-reader-tts";

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
  const titlebarDrag = useTitlebarWindowDrag();
  const [view, setView] = useState<"library" | "reader">("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
  const [progress, setProgress] = useState<{
    index: number;
    fraction: number;
    label?: string;
    chapterHref?: string;
  }>({
    index: 0,
    fraction: 0,
  });
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [readerMode, setReaderMode] = useState<ReaderMode>("reader");
  const [sessionRailOpen, setSessionRailOpen] = useState(true);
  const [bookCollapsed, setBookCollapsed] = useState(false);
  const [chatWidth, setChatWidth] = useState(loadChatPanelWidth);
  const [agentBookWidth, setAgentBookWidth] = useState(loadAgentBookWidth);
  const [tocVisible, setTocVisible] = useState(false);
  const [tocWidth, setTocWidth] = useState(loadTocWidth);
  const [annotationsVisible, setAnnotationsVisible] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationsFile>(emptyAnnotations);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [toc, setToc] = useState<TocItem[]>([]);
  const [sectionTicks, setSectionTicks] = useState<number[]>([]);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [openingBookId, setOpeningBookId] = useState<string | null>(null);
  const {
    theme: globalTheme,
    setTheme: setGlobalTheme,
    preferences,
    updatePreferences,
    flush: flushPreferences,
  } = usePreferences();
  // OS color scheme, followed live when the global theme is "system".
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const resolvedTheme = useMemo(
    () => resolveTheme(globalTheme, systemDark),
    [globalTheme, systemDark],
  );
  const styleState = useMemo(
    () => normalizeSettings(currentBook?.settings, preferences),
    [currentBook?.settings, preferences],
  );
  const bookImport = useBookImport();
  const readerRef = useRef<ReaderViewHandle>(null);
  const bookHidden = readerMode === "agent" && bookCollapsed;
  const tts = useReaderTts({
    readerRef,
    bookHidden,
    fileKey: fileData?.bookId ?? null,
  });
  const chatRef = useRef<ChatPanelHandle>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const tocDrawerRef = useRef<HTMLDivElement>(null);
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
  const closingRef = useRef(false);
  const openBookControllerRef = useRef(createLatestSerializedTaskController());
  // Drag can fire goToFraction faster than foliate finishes; keep latest-wins.
  const seekControllerRef = useRef(createLatestSerializedTaskController());
  // Latest fraction for open-book / relocate; do not write it into currentBook
  // on every relocate or ReaderView's [fileData, initialFraction] effect re-opens.
  const lastKnownFractionRef = useRef<number | undefined>(undefined);
  // Do not save until get_annotations succeeds; a failed/in-flight load
  // must not replace books/<id>/annotations.json with an empty snapshot.
  const annotationsWritableRef = useRef(false);
  // Track latest style state so handleBookReady can apply it after renderer mounts.
  // The ref holds the resolved (light/dark) theme for reader CSS injection.
  const styleStateRef = useRef(styleState);
  styleStateRef.current = { ...styleState, theme: resolvedTheme };

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

  const persistReaderMode = useDebouncedCallback(
    async (bookId: string, lastReaderMode: ReaderMode) => {
      await invoke("update_reading_state", { bookId, lastReaderMode });
    },
    500,
    reportPersistenceError,
  );

  const persistLayout = useDebouncedCallback(
    async (bookId: string, lastLayout: ReaderLayout) => {
      await invoke("update_reading_state", { bookId, lastLayout });
    },
    500,
    reportPersistenceError,
  );

  const flushReadingState = useCallback(
    async () => {
      try {
        await Promise.all([
          persistFraction.flush(),
          persistSettings.flush(),
          persistReaderMode.flush(),
          persistLayout.flush(),
          flushPreferences(),
        ]);
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [
      persistFraction,
      persistSettings,
      persistReaderMode,
      persistLayout,
      reportPersistenceError,
      flushPreferences,
    ],
  );

  const schedulePersistLayout = useCallback(
    (lastLayout: ReaderLayout) => {
      const bookId = fileData?.bookId ?? currentBook?.id;
      if (!bookId) return;
      persistLayout.schedule(bookId, lastLayout);
    },
    [currentBook?.id, fileData?.bookId, persistLayout],
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
  }, [flushReadingState, reportPersistenceError]);

  // Apply theme class to <html> so CSS variables cascade to portaled dialogs.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    const cls = themeToClassName(resolvedTheme);
    if (cls) root.classList.add(cls);
  }, [resolvedTheme]);

  // Apply styles + persist whenever style state changes.
  useEffect(() => {
    const css = generateStylesCss({ ...styleState, theme: resolvedTheme });
    readerRef.current?.setStyles(css);
  }, [styleState, resolvedTheme]);

  // Escape closes overlay drawers. Page turning lives in ReaderView
  // (chapter iframe + host); do not handle ArrowLeft/ArrowRight here.
  useEffect(() => {
    if (view !== "reader" || (!tocVisible && !annotationsVisible)) return;
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
        setAnnotationsVisible(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, tocVisible, annotationsVisible]);

  // A persisted width may exceed the current reader container (e.g. the window
  // was resized smaller since the width was saved); clamp it back on open so
  // the drawer and its resize handle never leave the container.
  useEffect(() => {
    if (!tocVisible) return;
    const container = tocDrawerRef.current?.parentElement;
    const maxWidth = container?.getBoundingClientRect().width;
    if (maxWidth != null && maxWidth > 0 && tocWidthRef.current > maxWidth) {
      setTocWidth(clampTocWidth(tocWidthRef.current, maxWidth));
    }
  }, [tocVisible]);

  const persistAnnotations = useCallback(
    async (bookId: string, next: AnnotationsFile) => {
      try {
        await invoke("save_annotations", { bookId, data: next });
      } catch (error) {
        reportPersistenceError(error);
        throw error;
      }
    },
    [reportPersistenceError],
  );

  const commitAnnotations = useCallback(
    async (next: AnnotationsFile) => {
      const bookId = fileData?.bookId;
      if (!bookId || !annotationsWritableRef.current) return;
      const previous = annotationsRef.current;
      annotationsRef.current = next;
      setAnnotations(next);
      try {
        await persistAnnotations(bookId, next);
      } catch {
        annotationsRef.current = previous;
        setAnnotations(previous);
      }
    },
    [fileData?.bookId, persistAnnotations],
  );

  const handleOpenBook = useCallback(async (bookId: string) => {
    // Serialize opens so a later click can supersede an older UI result without
    // letting two book workers complete out of order.
    const request = openBookControllerRef.current.run(async () => {
      await flushReadingState();
      const context = await invoke<BookOpenContext>("get_book_open_context", { bookId });
      const buffer = await invoke<ArrayBuffer>("open_book_bytes", {
        bookId,
        contentVersion: context.contentVersion,
      });
      await embeddedAgentRuntime.openBook(bookId, buffer.slice(0));
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
      setProgress({
        index: 0,
        fraction: context.lastFraction ?? 0,
      });
      setToc([]);
      setSectionTicks([]);
      setCurrentBook({
        id: context.bookId,
        title: context.title,
        author: "",
        coverPath: "",
        filePath: "",
        importedAt: "",
        lastFraction: context.lastFraction,
        settings: context.settings,
        lastReaderMode: isReaderMode(context.lastReaderMode)
          ? context.lastReaderMode
          : undefined,
        lastLayout: isReaderLayout(context.lastLayout) ? context.lastLayout : undefined,
      });
      setReaderMode(resolveReaderMode(context.lastReaderMode));
      const layout = resolveReaderLayout(context.lastLayout);
      setChatCollapsed(layout.chatCollapsed);
      setSessionRailOpen(layout.sessionRailOpen);
      setBookCollapsed(layout.bookCollapsed);
      setAnnotations(emptyAnnotations());
      annotationsRef.current = emptyAnnotations();
      annotationsWritableRef.current = false;

      setView("reader");
      try {
        const data = await invoke<AnnotationsFile>("get_annotations", {
          bookId: context.bookId,
        });
        if (!request.isLatest()) return;
        setAnnotations(data);
        annotationsRef.current = data;
        annotationsWritableRef.current = true;
      } catch (error) {
        if (request.isLatest()) reportPersistenceError(error);
      }
    } catch (err) {
      console.error("open_book_bytes error:", err);
      alert(t("reader.openFailed", { message: invokeErrorMessage(err) }));
    } finally {
      if (request.isLatest()) setOpeningBookId(null);
    }
  }, [flushReadingState, reportPersistenceError, t]);

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

  const handleBackToLibrary = useCallback(async () => {
    try {
      await flushReadingState();
    } catch {
      return;
    }
    tts.stop();
    embeddedAgentRuntime.closeBook();
    setView("library");
    setFileData(null);
    setCurrentBook(null);
    setProgress({ index: 0, fraction: 0 });
    setToc([]);
    setSectionTicks([]);
    setTocVisible(false);
    setAnnotationsVisible(false);
    setAnnotations(emptyAnnotations());
    annotationsRef.current = emptyAnnotations();
    setReaderMode("reader");
    setChatCollapsed(true);
    setSessionRailOpen(true);
    setBookCollapsed(false);
    annotationsWritableRef.current = false;
  }, [flushReadingState, tts.stop]);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string, chapterHref?: string) => {
      lastKnownFractionRef.current = fraction;
      setProgress({ index, fraction, label, chapterHref });
      // Persist reading position.
      if (fileData?.bookId) {
        persistFraction.schedule(fileData.bookId, fraction);
      }
    },
    [fileData?.bookId, persistFraction],
  );

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
      setCurrentBook((current) => (current ? { ...current, lastReaderMode: mode } : current));
      const bookId = fileData?.bookId ?? currentBook?.id;
      if (bookId) persistReaderMode.schedule(bookId, mode);
    },
    [currentBook?.id, fileData?.bookId, persistReaderMode],
  );

  useLayoutEffect(() => {
    if (chatCollapsed) return;
    const pending = pendingCaptureRef.current;
    if (!pending) return;
    pendingCaptureRef.current = null;
    chatRef.current?.fillInput(pending.text, pending.chapterHref);
  }, [chatCollapsed]);

  const handleBookReady = useCallback((bookToc: TocItem[]) => {
    setToc(bookToc);
    setSectionTicks(readerRef.current?.getSectionFractions() ?? []);
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
    (key: TypographyKey, value: number | string | boolean) => {
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

  const goToChapterHref = useCallback((href: string) => {
    readerRef.current?.goToTocItem(href);
  }, []);

  const handleTocGoTo = useCallback((href: string) => {
    goToChapterHref(href);
    setTocVisible(false);
  }, [goToChapterHref]);

  const handlePrevChapter = useCallback(() => {
    const href = chapterNavAt(toc, progress.chapterHref).prevHref;
    if (href) goToChapterHref(href);
  }, [goToChapterHref, progress.chapterHref, toc]);

  const handleNextChapter = useCallback(() => {
    const href = chapterNavAt(toc, progress.chapterHref).nextHref;
    if (href) goToChapterHref(href);
  }, [goToChapterHref, progress.chapterHref, toc]);

  const startTocResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const drawer = tocDrawerRef.current;
    if (!drawer) return;
    const container = drawer.parentElement;
    const maxWidth = container?.getBoundingClientRect().width ?? window.innerWidth;
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

  const closeOverlays = useCallback(() => {
    setTocVisible(false);
    setAnnotationsVisible(false);
  }, []);

  const jumpToAnnotation = useCallback(async (cfi: string, fraction?: number) => {
    const ok = await readerRef.current?.goToCfi(cfi);
    if (!ok && fraction != null) {
      await readerRef.current?.goToFraction(fraction);
    }
    closeOverlays();
  }, [closeOverlays]);

  const handleAddBookmark = useCallback(() => {
    const location = readerRef.current?.getLocation();
    if (!location?.cfi) return;
    const current = annotationsRef.current;
    const next = appendBookmark(current, createBookmark(location));
    if (next === current) return;
    void commitAnnotations(next);
  }, [commitAnnotations]);

  const handleDeleteBookmark = useCallback(
    (id: string) => {
      void commitAnnotations(removeBookmark(annotationsRef.current, id));
    },
    [commitAnnotations],
  );

  const handleJumpBookmark = useCallback(
    (bookmark: BookmarkRecord) => {
      void jumpToAnnotation(bookmark.cfi, bookmark.fraction);
    },
    [jumpToAnnotation],
  );

  const handleAddHighlight = useCallback(
    (selection: SelectionCfi) => {
      const current = annotationsRef.current;
      const next = appendHighlight(current, createHighlight(selection));
      if (next === current) return;
      void commitAnnotations(next);
    },
    [commitAnnotations],
  );

  const handleDeleteHighlight = useCallback(
    (id: string) => {
      const { next, removed } = removeHighlight(annotationsRef.current, id);
      if (removed) readerRef.current?.removeHighlight(removed.cfi);
      void commitAnnotations(next);
    },
    [commitAnnotations],
  );

  const handleUpdateHighlight = useCallback(
    (id: string, patch: { color?: HighlightColor; note?: string | null }) => {
      const current = annotationsRef.current;
      const next = updateHighlight(current, id, patch);
      if (next === current) return;
      void commitAnnotations(next);
    },
    [commitAnnotations],
  );

  const handleJumpHighlight = useCallback(
    (highlight: HighlightRecord) => {
      void jumpToAnnotation(highlight.cfi);
    },
    [jumpToAnnotation],
  );

  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;
  const chapterNav = useMemo(
    () => chapterNavAt(toc, progress.chapterHref),
    [progress.chapterHref, toc],
  );
  const bookTitle = currentBook?.title || fileData?.name || "";
  const sideCollapsed = readerMode === "reader" ? chatCollapsed : bookCollapsed;
  const sideWidth = readerMode === "reader" ? chatWidth : agentBookWidth;
  const chatHidden = readerMode === "reader" && chatCollapsed;
  const seekProgress = (frac: number) => {
    void seekControllerRef.current.run(async () => {
      await readerRef.current?.goToFraction(frac);
    });
  };
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

  const tocAnnotationButtons = (
    <div className="flex items-center gap-1">
      <Button
        size="icon-sm"
        variant={tocVisible ? "secondary" : "ghost"}
        onClick={() => {
          const next = !tocVisible;
          setTocVisible(next);
          setAnnotationsVisible(false);
          if (next && bookCollapsed) {
            setBookCollapsed(false);
            schedulePersistLayout({
              chatCollapsed,
              bookCollapsed: false,
              sessionRailOpen,
            });
          }
        }}
        aria-label={t("reader.toc")}
      >
        <List />
      </Button>
      <Button
        size="icon-sm"
        variant={annotationsVisible ? "secondary" : "ghost"}
        onClick={() => {
          const next = !annotationsVisible;
          setAnnotationsVisible(next);
          setTocVisible(false);
          if (next && bookCollapsed) {
            setBookCollapsed(false);
            schedulePersistLayout({
              chatCollapsed,
              bookCollapsed: false,
              sessionRailOpen,
            });
          }
        }}
        aria-label={t("reader.annotations")}
      >
        <Bookmark />
      </Button>
    </div>
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
      <header className={titlebarClassName()}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void handleBackToLibrary()}
          aria-label={t("reader.backToLibrary")}
        >
          <ChevronLeft />
        </Button>
        {readerMode === "reader" ? tocAnnotationButtons : null}
        <h1
          className="min-w-0 shrink truncate select-none text-sm font-medium"
          data-titlebar-drag
          {...titlebarDrag}
        >
          {bookTitle}
        </h1>
        <div
          className="min-h-0 min-w-0 flex-1 select-none self-stretch"
          data-titlebar-drag
          {...titlebarDrag}
        />
        <div className="flex items-center gap-1">
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
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label={t("reader.fontAndTheme")}
          >
            <Type />
          </Button>
        </div>
        <div className="h-4 w-px shrink-0 bg-border" />
        {readerMode === "agent" ? tocAnnotationButtons : null}
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              handleReaderModeChange(readerMode === "reader" ? "agent" : "reader")
            }
            aria-label={
              readerMode === "reader" ? t("reader.switchToAgent") : t("reader.switchToReader")
            }
          >
            {readerMode === "reader" ? <Bot /> : <BookOpen />}
          </Button>
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
                ? "relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l"
                : "relative flex min-h-0 min-w-0 flex-col overflow-hidden"
          }
          style={{ gridArea: "book" }}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {fileData && (
              <ReaderView
                ref={readerRef}
                fileData={fileData}
                onRelocate={handleRelocate}
                onSelectionCapture={handleSelectionCapture}
                onHighlight={handleAddHighlight}
                onUpdateHighlight={handleUpdateHighlight}
                onDeleteHighlight={handleDeleteHighlight}
                highlights={annotations.highlights}
                initialFraction={currentBook?.lastFraction}
                onBookReady={handleBookReady}
                onTtsToggle={tts.toggle}
                onUserRelocate={tts.onUserRelocate}
                stylesCss={generateStylesCss({ ...styleState, theme: resolvedTheme })}
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
                <div
                  ref={tocDrawerRef}
                  className="absolute inset-y-0 left-0 z-30 overflow-hidden border-r bg-background"
                  style={{ width: tocWidth }}
                >
                  <TocSidebar
                    toc={toc}
                    currentHref={progress.chapterHref}
                    onGoTo={handleTocGoTo}
                  />
                </div>
                <div
                  className="absolute inset-y-0 z-40 w-1.5 cursor-col-resize touch-none select-none bg-transparent hover:bg-primary/30"
                  style={{ left: tocWidth - 3 }}
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={startTocResize}
                  onPointerMove={onTocResizeMove}
                  onPointerUp={endTocResize}
                  onPointerCancel={cancelTocResize}
                />
              </>
            )}
            {annotationsVisible && (
              <>
                <button
                  type="button"
                  className="absolute inset-0 z-20 bg-background/50"
                  aria-label={t("reader.closeAnnotations")}
                  onClick={() => setAnnotationsVisible(false)}
                />
                <div className="absolute inset-y-0 left-0 z-30 w-56 overflow-hidden border-r bg-background">
                  <AnnotationsSidebar
                    bookmarks={annotations.bookmarks}
                    highlights={annotations.highlights}
                    onAddBookmark={handleAddBookmark}
                    onJumpBookmark={handleJumpBookmark}
                    onDeleteBookmark={handleDeleteBookmark}
                    onJumpHighlight={handleJumpHighlight}
                    onDeleteHighlight={handleDeleteHighlight}
                  />
                </div>
              </>
            )}
          </div>
          {tts.error ? (
            <div
              role="alert"
              className="border-t px-3 py-1.5 text-xs text-destructive"
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
            ticks={sectionTicks}
            onSeek={seekProgress}
            onPrevChapter={handlePrevChapter}
            onNextChapter={handleNextChapter}
            canPrevChapter={chapterNav.canPrev}
            canNextChapter={chapterNav.canNext}
            previewLabelAt={(frac) => readerRef.current?.previewLabelAt(frac)}
          />
        </div>
        <div
          data-testid="reader-chat-cell"
          hidden={chatHidden}
          className={
            !chatHidden && readerMode === "reader"
              ? "h-full min-h-0 min-w-0 overflow-hidden border-l"
              : "h-full min-h-0 min-w-0 overflow-hidden"
          }
          style={{ gridArea: "chat" }}
        >
          <ChatPanel
            ref={chatRef}
            currentChapterHref={progress.chapterHref}
            bookId={fileData?.bookId ?? ""}
            variant={readerMode === "agent" ? "workspace" : "docked"}
            sessionRailOpen={sessionRailOpen}
            onSessionRailOpenChange={(open) => {
              setSessionRailOpen(open);
              schedulePersistLayout({
                chatCollapsed,
                bookCollapsed,
                sessionRailOpen: open,
              });
            }}
          />
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
