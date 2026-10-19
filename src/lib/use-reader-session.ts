import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ReaderHistoryState,
  ReaderViewHandle,
  SelectionCfi,
  TocItem,
} from "@/components/ReaderView";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
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
import {
  bookSettingsSnapshot,
  generateStylesCss,
  isTypographyOverridden,
  normalizeSettings,
  TYPOGRAPHY_KEYS,
  type TypographyKey,
} from "@/lib/reader-styles";
import { usePreferences, resolveTheme, themeToClassName, type AppPreferences } from "@/lib/preferences";
import { importedFontFaceCss, useImportedFonts } from "@/lib/imported-fonts";
import type {
  AnnotationsFile,
  BookOpenContext,
  BookRecord,
  HighlightColor,
  ReaderLayout,
  ReadingSettings,
} from "@/types/library";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { invokeErrorMessage } from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";
import { createLatestSerializedTaskController } from "@/lib/latest-serialized-task";
import { notifySyncActivity } from "@/lib/sync-activity";
import { useT } from "@/lib/i18n";
import { isReaderMode, type ReaderMode } from "@/lib/reader-mode";
import { isReaderLayout } from "@/lib/reader-layout";
import {
  ancestorKeysForHref,
  chapterNavAt,
  collapsibleKeys,
  unionKeys,
} from "@/lib/toc-items";
import { useBookSearch } from "@/lib/use-book-search";
import { loadReaderFlow } from "@/lib/reader-flow";
import { useReadingStatus } from "@/lib/use-reading-status";
import { useKosync } from "@/lib/use-kosync";

export interface FileData {
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  bookId: string;
}

export interface ReaderProgress {
  index: number;
  fraction: number;
  label?: string;
  chapterHref?: string;
}

export type DownloadDecision = "download" | "skip" | "cancel";

export interface UseReaderSessionOptions {
  /**
   * The shell's own per-Book state (mode, layout) for a Book that just
   * opened. Runs before its annotations load.
   */
  onOpened?: (context: BookOpenContext) => void;
  /**
   * Asked before every open whether the Book's file may download now:
   * "download" (the default), "skip" (open the copy already on this device,
   * leave a newer one for later) or "cancel" (a Book not on this device
   * stays not cached and doesn't open). The mobile shell asks before
   * spending mobile data.
   */
  beforeDownload?: (bookId: string) => Promise<DownloadDecision>;
}

/**
 * The open Book as both shells see it: opening and closing, the reading
 * position, per-Book typography, Annotations, the table of contents,
 * find-in-book, Reading status, KOReader Sync, and the theme. Everything
 * here persists through the backend; layout (panels, sheets, drawers) is the
 * shell's business.
 */
export function useReaderSession(options: UseReaderSessionOptions = {}) {
  const { t } = useT();
  const onOpenedRef = useRef(options.onOpened);
  onOpenedRef.current = options.onOpened;
  const beforeDownloadRef = useRef(options.beforeDownload);
  beforeDownloadRef.current = options.beforeDownload;
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
  const [progress, setProgress] = useState<ReaderProgress>({ index: 0, fraction: 0 });
  const [readerFlow, setReaderFlow] = useState(loadReaderFlow);
  const readerFlowRef = useRef(readerFlow);
  readerFlowRef.current = readerFlow;
  const [readerHistory, setReaderHistory] = useState<ReaderHistoryState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [annotations, setAnnotations] = useState<AnnotationsFile>(emptyAnnotations);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const [toc, setToc] = useState<TocItem[]>([]);
  const [tocExpanded, setTocExpanded] = useState<string[]>([]);
  const [chapterTicks, setChapterTicks] = useState<number[]>([]);
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
  const readerRef = useRef<ReaderViewHandle>(null);
  const bookSearch = useBookSearch({
    search: (query) => readerRef.current?.searchBook(query) ?? null,
    clear: () => readerRef.current?.clearSearch(),
    goTo: (hit) => void readerRef.current?.goToCfi(hit.cfi),
    resetKey: fileData?.bookId ?? null,
  });
  const openBookControllerRef = useRef(createLatestSerializedTaskController());
  // Drag can fire goToFraction faster than foliate finishes; keep latest-wins.
  const seekControllerRef = useRef(createLatestSerializedTaskController());
  // Latest fraction for open-book / relocate; do not write lastFraction / lastCfi
  // into currentBook on every relocate or ReaderView's open effect re-opens.
  const lastKnownFractionRef = useRef<number | undefined>(undefined);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  // Do not save until get_annotations succeeds; a failed/in-flight load
  // must not replace books/<id>/annotations.json with an empty snapshot.
  const annotationsWritableRef = useRef(false);
  // Bumped by every local annotations edit, so a reload that raced one is
  // discarded rather than hiding the edit.
  const annotationsEditCountRef = useRef(0);
  // Track latest style state so handleBookReady can apply it after renderer mounts.
  // The ref holds the resolved (light/dark) theme for reader CSS injection.
  const styleStateRef = useRef(styleState);
  styleStateRef.current = { ...styleState, theme: resolvedTheme };
  const importedFonts = useImportedFonts();
  const fontFaceCss = useMemo(() => importedFontFaceCss(importedFonts), [importedFonts]);
  const fontFaceCssRef = useRef(fontFaceCss);
  fontFaceCssRef.current = fontFaceCss;

  const reportPersistenceError = useCallback((error: unknown) => {
    console.error("Failed to persist reading state:", error);
    setPersistenceError(invokeErrorMessage(error));
  }, []);

  const readingStatus = useReadingStatus({ onError: reportPersistenceError });

  const getLocalFraction = useCallback(() => lastKnownFractionRef.current, []);
  const kosync = useKosync({
    bookId: fileData?.bookId ?? null,
    readerRef,
    getLocalFraction,
  });

  // Persist reading position (debounced). One invoke for fraction + CFI.
  const persistPosition = useDebouncedCallback(
    async (bookId: string, fraction: number, cfi?: string) => {
      await invoke("update_reading_state", {
        bookId,
        lastFraction: fraction,
        ...(cfi ? { lastCfi: cfi } : {}),
      });
      notifySyncActivity();
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
          persistPosition.flush(),
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
      persistPosition,
      persistSettings,
      persistReaderMode,
      persistLayout,
      reportPersistenceError,
      flushPreferences,
    ],
  );

  const bookIdRef = useRef<string | undefined>(undefined);
  bookIdRef.current = fileData?.bookId ?? currentBook?.id;

  const schedulePersistLayout = useCallback(
    (lastLayout: ReaderLayout) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      persistLayout.schedule(bookId, lastLayout);
    },
    [persistLayout],
  );

  /** Remember the Book's last mode (Reading / Agent); both shells map to it. */
  const rememberReaderMode = useCallback(
    (mode: ReaderMode) => {
      setCurrentBook((current) => (current ? { ...current, lastReaderMode: mode } : current));
      const bookId = bookIdRef.current;
      if (bookId) persistReaderMode.schedule(bookId, mode);
    },
    [persistReaderMode],
  );

  // Apply theme class to <html> so CSS variables cascade to portaled dialogs.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    const cls = themeToClassName(resolvedTheme);
    if (cls) root.classList.add(cls);
  }, [resolvedTheme]);

  // Apply styles + persist whenever style state changes.
  useEffect(() => {
    const css = generateStylesCss({ ...styleState, theme: resolvedTheme }, fontFaceCss);
    readerRef.current?.setStyles(css);
    readerRef.current?.setColumnCount(styleState.columnCount);
  }, [styleState, resolvedTheme, fontFaceCss]);

  useEffect(() => {
    readerRef.current?.setFlow(readerFlow);
  }, [readerFlow]);

  const persistAnnotations = useCallback(
    async (bookId: string, next: AnnotationsFile, base: AnnotationsFile) => {
      try {
        // `base` is what this edit started from: the backend keeps entries a
        // Sync wrote since then, and only counts our own removals as deletions.
        await invoke("save_annotations", { bookId, data: next, base });
        notifySyncActivity();
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
      annotationsEditCountRef.current += 1;
      annotationsRef.current = next;
      setAnnotations(next);
      try {
        await persistAnnotations(bookId, next, previous);
      } catch {
        annotationsRef.current = previous;
        setAnnotations(previous);
      }
    },
    [fileData?.bookId, persistAnnotations],
  );

  const openBook = useCallback(async (bookId: string) => {
    // Serialize opens so a later click can supersede an older UI result without
    // letting two book workers complete out of order.
    const request = openBookControllerRef.current.run(async () => {
      await flushReadingState();
      const decision = (await beforeDownloadRef.current?.(bookId)) ?? "download";
      if (decision === "cancel") return null;
      // A synced book that isn't cached locally downloads on demand; for
      // cached books this is a cheap no-op.
      if (decision === "download") await invoke("sync_download_book_file", { bookId });
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
      if (result.status === "stale" || result.value === null) return;
      const { context, buffer } = result.value;
      setFileData({
        bytes: epubBytesFromIpc(buffer),
        name: context.name,
        bookId: context.bookId,
      });

      // Build a partial BookRecord for passing lastFraction / lastCfi / settings to ReaderView.
      // The full record is fetched from list_books; this context stays lightweight.
      lastKnownFractionRef.current = context.lastFraction;
      readingStatus.begin(context.bookId, context.readingStatus);
      setProgress({
        index: 0,
        fraction: context.lastFraction ?? 0,
      });
      setToc([]);
      setTocExpanded([]);
      setChapterTicks([]);
      setCurrentBook({
        id: context.bookId,
        title: context.title,
        author: "",
        coverPath: "",
        filePath: "",
        importedAt: "",
        lastFraction: context.lastFraction,
        lastCfi: context.lastCfi,
        settings: context.settings,
        lastReaderMode: isReaderMode(context.lastReaderMode)
          ? context.lastReaderMode
          : undefined,
        lastLayout: isReaderLayout(context.lastLayout) ? context.lastLayout : undefined,
        readingStatus: context.readingStatus,
      });
      setAnnotations(emptyAnnotations());
      annotationsRef.current = emptyAnnotations();
      annotationsWritableRef.current = false;
      onOpenedRef.current?.(context);

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
  }, [flushReadingState, readingStatus.begin, reportPersistenceError, t]);

  /** Close the open Book; false (and the Book stays open) when saving failed. */
  const closeBook = useCallback(async (): Promise<boolean> => {
    try {
      await flushReadingState();
    } catch {
      return false;
    }
    void kosync.flush();
    embeddedAgentRuntime.closeBook();
    readingStatus.end();
    setFileData(null);
    setCurrentBook(null);
    setProgress({ index: 0, fraction: 0 });
    setToc([]);
    setTocExpanded([]);
    setChapterTicks([]);
    setAnnotations(emptyAnnotations());
    annotationsRef.current = emptyAnnotations();
    annotationsWritableRef.current = false;
    return true;
  }, [flushReadingState, kosync.flush, readingStatus.end]);

  const handleRelocate = useCallback(
    (index: number, fraction: number, label?: string, chapterHref?: string, cfi?: string) => {
      lastKnownFractionRef.current = fraction;
      setProgress({ index, fraction, label, chapterHref });
      readingStatus.onRelocate(fraction);
      kosync.onRelocate(fraction);
      // Persist reading position. Do not write lastCfi / lastFraction into currentBook.
      if (fileData?.bookId) {
        persistPosition.schedule(fileData.bookId, fraction, cfi);
      }
    },
    [fileData?.bookId, kosync.onRelocate, persistPosition, readingStatus.onRelocate],
  );

  const handleBookReady = useCallback((bookToc: TocItem[]) => {
    setToc(bookToc);
    setTocExpanded(ancestorKeysForHref(bookToc, progressRef.current.chapterHref));
    setChapterTicks(readerRef.current?.getChapterTicks() ?? []);
    // Apply saved styles now that the renderer exists.
    readerRef.current?.setStyles(generateStylesCss(styleStateRef.current, fontFaceCssRef.current));
    readerRef.current?.setColumnCount(styleStateRef.current.columnCount);
    readerRef.current?.setFlow(readerFlowRef.current);
    void kosync.onBookReady();
  }, [kosync.onBookReady]);

  useEffect(() => {
    if (toc.length === 0) return;
    setTocExpanded((current) =>
      unionKeys(current, ancestorKeysForHref(toc, progress.chapterHref)),
    );
  }, [progress.chapterHref, toc]);

  // A Sync may have merged other devices' annotations into the open book's
  // file; show them, and make the next edit start from them.
  useEffect(() => {
    const bookId = fileData?.bookId;
    if (!bookId) return;
    let disposed = false;
    const reloadAnnotations = () => {
      if (!annotationsWritableRef.current) return;
      const editCount = annotationsEditCountRef.current;
      void invoke<AnnotationsFile>("get_annotations", { bookId })
        .then((data) => {
          if (disposed || annotationsEditCountRef.current !== editCount) return;
          annotationsRef.current = data;
          setAnnotations(data);
        })
        .catch(reportPersistenceError);
    };
    window.addEventListener("litera:sync-applied", reloadAnnotations);
    return () => {
      disposed = true;
      window.removeEventListener("litera:sync-applied", reloadAnnotations);
    };
  }, [fileData?.bookId, reportPersistenceError]);

  const persistBookSnapshot = useCallback(
    (settings: ReadingSettings) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      persistSettings.schedule(bookId, settings);
    },
    [persistSettings],
  );

  /** With a Book open the change is that Book's; otherwise it's the default. */
  const handleTypographyChange = useCallback(
    (key: TypographyKey, value: number | string | boolean) => {
      if (currentBook) {
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
    [currentBook, persistBookSnapshot, updatePreferences],
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

  const handleTocToggle = useCallback((key: string) => {
    setTocExpanded((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }, []);

  const handleTocExpandAll = useCallback(() => {
    setTocExpanded(collapsibleKeys(toc));
  }, [toc]);

  const handleTocCollapseAll = useCallback(() => {
    setTocExpanded(ancestorKeysForHref(toc, progress.chapterHref));
  }, [progress.chapterHref, toc]);

  const handlePrevChapter = useCallback(() => {
    const href = chapterNavAt(toc, progress.chapterHref).prevHref;
    if (href) goToChapterHref(href);
  }, [goToChapterHref, progress.chapterHref, toc]);

  const handleNextChapter = useCallback(() => {
    const href = chapterNavAt(toc, progress.chapterHref).nextHref;
    if (href) goToChapterHref(href);
  }, [goToChapterHref, progress.chapterHref, toc]);

  /** Jump to an annotation's CFI, falling back to its fraction. */
  const jumpToCfi = useCallback(async (cfi: string, fraction?: number) => {
    const ok = await readerRef.current?.goToCfi(cfi);
    if (!ok && fraction != null) {
      await readerRef.current?.goToFraction(fraction);
    }
  }, []);

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

  const seekProgress = useCallback((frac: number) => {
    void seekControllerRef.current.run(async () => {
      await readerRef.current?.goToFraction(frac);
    });
  }, []);

  const chapterLabel = progress.label ?? `Chapter ${progress.index + 1}`;
  const chapterNav = useMemo(
    () => chapterNavAt(toc, progress.chapterHref),
    [progress.chapterHref, toc],
  );
  const bookTitle = currentBook?.title || fileData?.name || "";
  const editingBook = Boolean(currentBook || fileData);
  const overriddenKeys: TypographyKey[] = editingBook
    ? TYPOGRAPHY_KEYS.filter((key) => isTypographyOverridden(currentBook?.settings, key))
    : [];
  const stylesCss = generateStylesCss({ ...styleState, theme: resolvedTheme }, fontFaceCss);

  return {
    readerRef,
    fileData,
    currentBook,
    bookTitle,
    progress,
    chapterLabel,
    chapterNav,
    chapterTicks,
    readerHistory,
    setReaderHistory,
    readerFlow,
    setReaderFlow,
    annotations,
    toc,
    tocExpanded,
    persistenceError,
    clearPersistenceError: useCallback(() => setPersistenceError(null), []),
    reportPersistenceError,
    openingBookId,
    // Theme and typography
    globalTheme,
    setGlobalTheme,
    resolvedTheme,
    styleState,
    stylesCss,
    editingBook,
    overriddenKeys,
    handleTypographyChange,
    handleRestoreDefault,
    // Lifecycle
    openBook,
    closeBook,
    flushReadingState,
    rememberReaderMode,
    schedulePersistLayout,
    // ReaderView callbacks
    handleRelocate,
    handleBookReady,
    // Navigation
    goToChapterHref,
    handleTocToggle,
    handleTocExpandAll,
    handleTocCollapseAll,
    handlePrevChapter,
    handleNextChapter,
    seekProgress,
    jumpToCfi,
    // Annotations
    handleAddBookmark,
    handleDeleteBookmark,
    handleAddHighlight,
    handleDeleteHighlight,
    handleUpdateHighlight,
    // Features riding on the open Book
    bookSearch,
    readingStatus,
    kosync,
  };
}

export type ReaderSession = ReturnType<typeof useReaderSession>;
