import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BookRecord, ReadingStatus, TrashEntry } from "@/types/library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WindowControls,
  titlebarClassName,
  useTitlebarWindowDrag,
} from "@/components/WindowControls";
import { PanelLeft, Plus, Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { BookCard, BookListRow, BookResumeTile } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import { TrashDialog } from "@/components/TrashDialog";
import {
  LibrarySelectionBar,
  LibraryShelfToolbar,
  STATUS_OPTIONS,
} from "@/components/LibraryShelfToolbar";
import { LibrarySidebar } from "@/components/LibrarySidebar";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { invokeErrorMessage } from "@/lib/app-error";
import { notifySyncActivity } from "@/lib/sync-activity";
import { useBookImport } from "@/lib/use-book-import";
import { useT } from "@/lib/i18n";
import { detectDesktopOs } from "@/lib/platform";
import {
  countByStatus,
  filterBooks,
  filterByStatus,
  naturalOrderFor,
  sortBooks,
  takeRecent,
  type LibrarySortKey,
  type LibrarySortOrder,
  type LibraryStatusFilter,
} from "@/lib/library-shelf";
import {
  loadLibrarySidebarCollapsed,
  loadLibrarySort,
  loadLibrarySortOrder,
  loadLibraryStatusFilter,
  loadLibraryView,
  parseLibrarySort,
  saveLibrarySidebarCollapsed,
  saveLibrarySort,
  saveLibrarySortOrder,
  saveLibraryStatusFilter,
  saveLibraryView,
  type LibraryViewMode,
} from "@/lib/library-shelf-prefs";

interface LibraryViewProps {
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId?: string | null;
  onOpenSettings: () => void;
}

function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith(".epub");
}

/** Escape and select-all belong to an open dialog or menu, not the shelf. */
function overlayOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

/** Below Tailwind's `md` the sidebar becomes a drawer. */
const WIDE_QUERY = "(min-width: 48rem)";

function matchesWide(): boolean {
  // jsdom and very old webviews have no matchMedia: treat them as wide.
  return typeof window.matchMedia !== "function" || window.matchMedia(WIDE_QUERY).matches;
}

function useWideWindow(): boolean {
  const [wide, setWide] = useState(matchesWide);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_QUERY);
    const onChange = () => setWide(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

/** `update_book_curation` arguments: null leaves a field alone. */
interface CurationChange {
  readingStatus: string | null;
  starred: boolean | null;
}

export function LibraryView({ onOpenBook, openingBookId = null, onOpenSettings }: LibraryViewProps) {
  const { t } = useT();
  const titlebarDrag = useTitlebarWindowDrag();
  const [books, setBooks] = useState<BookRecord[]>([]);
  // Until the first list_books settles, an empty `books` means "not read yet",
  // not "empty library": rendering the empty state then would flash it.
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<LibrarySortKey>(loadLibrarySort);
  const [order, setOrder] = useState<LibrarySortOrder>(() =>
    loadLibrarySortOrder(loadLibrarySort()),
  );
  const [view, setView] = useState<LibraryViewMode>(loadLibraryView);
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>(
    loadLibraryStatusFilter,
  );
  const wide = useWideWindow();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadLibrarySidebarCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailsBook, setDetailsBook] = useState<BookRecord | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [coverRev, setCoverRev] = useState<Record<string, number>>({});
  const {
    notices,
    dismissNotice,
    pushNotice,
    confirmOpen,
    confirmRequest,
    settleConfirm,
    askConfirm,
    importing,
    importingRef,
    importFromPicker,
    importFromPaths,
  } = useBookImport();

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const refreshBooks = useCallback(async () => {
    try {
      const list = await invoke<BookRecord[]>("list_books");
      setBooks(list);
      setLoadError(null);
    } catch (err) {
      console.error("list_books error:", err);
      setLoadError(invokeErrorMessage(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshBooks();
  }, [refreshBooks]);

  const refreshTrash = useCallback(async () => {
    try {
      setTrashEntries(await invoke<TrashEntry[]>("list_trashed_books"));
    } catch (err) {
      // The Trash is a recovery affordance, not a core path: a failure here
      // must not take the shelf down with it.
      console.error("list_trashed_books error:", err);
    }
  }, []);

  useEffect(() => {
    void refreshTrash();
  }, [refreshTrash]);

  // A sync pass may have rendered new placeholders, promoted downloads, or
  // propagated deletions: re-read the shelf without waiting for a remount.
  useEffect(() => {
    const onSyncApplied = () => {
      void refreshBooks();
      void refreshTrash();
    };
    window.addEventListener("litera:sync-applied", onSyncApplied);
    return () => {
      window.removeEventListener("litera:sync-applied", onSyncApplied);
    };
  }, [refreshBooks, refreshTrash]);

  // Synced books whose EPUB has not downloaded yet: fetch their cover on
  // demand the first time the shelf renders them, so a new device's shelf
  // looks right without downloading whole books. Attempted once per book
  // per session; failures are silent (sync may not be configured).
  const coverAttemptsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = books.filter(
      (book) =>
        book.cached === false &&
        !book.coverPath &&
        !coverAttemptsRef.current.has(book.id),
    );
    if (missing.length === 0) return;
    for (const book of missing) coverAttemptsRef.current.add(book.id);
    let cancelled = false;
    void (async () => {
      let downloaded = false;
      for (const book of missing) {
        try {
          const fetched = await invoke<boolean>("sync_ensure_cover", {
            bookId: book.id,
          });
          if (fetched) downloaded = true;
        } catch {
          // No cover on the backend — the initial-letter fallback renders.
        }
      }
      if (!cancelled && downloaded) await refreshBooks();
    })();
    return () => {
      cancelled = true;
    };
  }, [books, refreshBooks]);

  const handleImport = useCallback(async () => {
    if (importingRef.current) return;
    await importFromPicker();
    await refreshBooks();
  }, [importFromPicker, importingRef, refreshBooks]);

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const epubs = paths.filter(isEpubPath);
    if (epubs.length === 0 || importingRef.current) return;
    await importFromPaths(epubs);
    await refreshBooks();
  }, [importFromPaths, importingRef, refreshBooks]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebviewWindow()
        .onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            void handleDroppedPaths(event.payload.paths);
          }
        })
        .then((fn) => {
          if (disposed) {
            fn();
            return;
          }
          unlisten = fn;
        })
        .catch((err) => {
          console.error("onDragDropEvent error:", err);
        });
    } catch (err) {
      console.error("onDragDropEvent error:", err);
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleDroppedPaths]);

  const requestDelete = useCallback(async (targets: BookRecord[]) => {
    if (targets.length === 0) return;
    const single = targets.length === 1;
    const confirmed = await askConfirm({
      title: single
        ? t("library.deleteTitleOne", { title: targets[0].title })
        : t("library.deleteTitleMany", { count: targets.length }),
      description: single
        ? t("library.deleteDescOne")
        : t("library.deleteDescMany"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!confirmed) return;

    const failures: string[] = [];
    for (const book of targets) {
      try {
        await invoke("delete_book", { bookId: book.id });
        notifySyncActivity();
      } catch (err) {
        console.error("delete error:", err);
        failures.push(book.title);
      }
    }
    await refreshBooks();
    await refreshTrash();
    if (selectMode) exitSelectMode();
    if (failures.length > 0) {
      pushNotice({
        kind: "error",
        message: t("library.deleteFailed", { titles: failures.join(t("common.listJoin")) }),
      });
    }
  }, [askConfirm, exitSelectMode, pushNotice, refreshBooks, refreshTrash, selectMode, t]);

  const handleDelete = useCallback(
    (bookId: string) => {
      const book = books.find((item) => item.id === bookId);
      if (!book) return;
      void requestDelete([book]);
    },
    [books, requestDelete],
  );

  const handleToggleSelect = useCallback((bookId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }, []);

  const handleSortChange = useCallback((value: string) => {
    const next = parseLibrarySort(value);
    // Picking a key starts it in that key's natural direction instead of
    // carrying over the previous key's direction.
    const nextOrder = naturalOrderFor(next);
    setSort(next);
    setOrder(nextOrder);
    saveLibrarySort(next);
    saveLibrarySortOrder(nextOrder);
  }, []);

  const handleOrderChange = useCallback((next: LibrarySortOrder) => {
    setOrder(next);
    saveLibrarySortOrder(next);
  }, []);

  const handleViewChange = useCallback((next: LibraryViewMode) => {
    setView(next);
    saveLibraryView(next);
  }, []);

  const handleStatusFilterChange = useCallback((value: LibraryStatusFilter) => {
    setStatusFilter(value);
    saveLibraryStatusFilter(value);
    setDrawerOpen(false);
  }, []);

  // Wide windows collapse the sidebar in place (remembered); narrow ones
  // open it as a drawer over the shelf.
  const handleToggleSidebar = useCallback(() => {
    if (!wide) {
      setDrawerOpen((open) => !open);
      return;
    }
    setSidebarCollapsed((collapsed) => {
      saveLibrarySidebarCollapsed(!collapsed);
      return !collapsed;
    });
  }, [wide]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setStatusFilter("all");
    saveLibraryStatusFilter("all");
  }, []);

  // Curation has its own command so starring or marking never rewrites the
  // metadata fields the details dialog owns. One path serves a single card
  // and a batch from the selection bar.
  const updateCuration = useCallback(
    async (targets: readonly BookRecord[], change: CurationChange) => {
      const updated = new Map<string, BookRecord>();
      const failures: { title: string; message: string }[] = [];
      for (const target of targets) {
        try {
          const record = await invoke<BookRecord>("update_book_curation", {
            bookId: target.id,
            ...change,
          });
          updated.set(record.id, record);
        } catch (err) {
          console.error("update_book_curation error:", err);
          failures.push({ title: target.title, message: invokeErrorMessage(err) });
        }
      }
      if (updated.size > 0) {
        setBooks((current) => current.map((item) => updated.get(item.id) ?? item));
        notifySyncActivity();
      }
      if (failures.length === 0) return;
      pushNotice({
        kind: "error",
        message:
          targets.length === 1
            ? t("library.curationFailed", { message: failures[0].message })
            : t("library.batchCurationFailed", {
                titles: failures.map((failure) => failure.title).join(t("common.listJoin")),
              }),
      });
    },
    [pushNotice, t],
  );

  const handleToggleStar = useCallback(
    (target: BookRecord) =>
      updateCuration([target], { readingStatus: null, starred: target.starred !== true }),
    [updateCuration],
  );

  const handleChangeStatus = useCallback(
    (target: BookRecord, status: ReadingStatus) =>
      updateCuration([target], { readingStatus: status, starred: null }),
    [updateCuration],
  );

  const handleDetailsSaved = useCallback((record: BookRecord, coverChanged: boolean) => {
    setBooks((current) =>
      current.map((item) => (item.id === record.id ? record : item)),
    );
    if (coverChanged) {
      setCoverRev((current) => ({ ...current, [record.id]: Date.now() }));
    }
  }, []);

  const handleRestoreEntry = useCallback(
    async (entry: TrashEntry) => {
      try {
        await invoke("restore_trashed_book", { entryId: entry.entryId });
        // Restoring revokes the Book Tombstone, so the revival reaches Sync.
        notifySyncActivity();
        await refreshBooks();
        await refreshTrash();
      } catch (err) {
        console.error("restore_trashed_book error:", err);
        pushNotice({
          kind: "error",
          message: t("library.trashRestoreFailed", {
            title: entry.title || t("library.trashUnnamed"),
            message: invokeErrorMessage(err),
          }),
        });
      }
    },
    [pushNotice, refreshBooks, refreshTrash, t],
  );

  const handlePurgeEntry = useCallback(
    async (entry: TrashEntry) => {
      const confirmed = await askConfirm({
        title: t("library.trashPurgeTitle", { title: entry.title }),
        description: t("library.trashPurgeDesc"),
        confirmLabel: t("library.trashPurge"),
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await invoke("purge_trashed_book", { entryId: entry.entryId });
        await refreshTrash();
      } catch (err) {
        console.error("purge_trashed_book error:", err);
        pushNotice({
          kind: "error",
          message: t("library.trashPurgeFailed", {
            title: entry.title || t("library.trashUnnamed"),
            message: invokeErrorMessage(err),
          }),
        });
      }
    },
    [askConfirm, pushNotice, refreshTrash, t],
  );

  const handlePurgeAll = useCallback(async () => {
    if (trashEntries.length === 0) return;
    const confirmed = await askConfirm({
      title: t("library.trashPurgeAllTitle", { count: trashEntries.length }),
      description: t("library.trashPurgeDesc"),
      confirmLabel: t("library.trashPurgeAll"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await invoke("purge_all_trashed_books");
      await refreshTrash();
    } catch (err) {
      console.error("purge_all_trashed_books error:", err);
      pushNotice({
        kind: "error",
        message: t("library.trashPurgeAllFailed", {
          message: invokeErrorMessage(err),
        }),
      });
    }
  }, [askConfirm, pushNotice, refreshTrash, t, trashEntries.length]);

  const searching = search.trim().length > 0;
  // Continue reading only shows when it adds something: not while searching
  // or selecting, and not when the shelf is already newest-opened first, where
  // its tiles would just repeat the shelf's first row.
  const showRecents =
    !searching && !selectMode && !(sort === "recent" && order === "desc");
  const recents = useMemo(
    // Continue reading narrows with the status filter like the main grid: a
    // reader looking at "unread" should not be shown other books up top.
    () => (showRecents ? takeRecent(filterByStatus(books, statusFilter)) : []),
    [books, showRecents, statusFilter],
  );
  const searched = useMemo(() => filterBooks(books, search), [books, search]);
  const statusCounts = useMemo(() => countByStatus(searched), [searched]);
  const visible = useMemo(
    () => sortBooks(filterByStatus(searched, statusFilter), sort, order),
    [order, searched, sort, statusFilter],
  );
  // The list view's "not downloaded" column is all-or-nothing across the
  // visible rows so the columns after it stay aligned.
  const cacheColumn = visible.some((book) => book.cached === false);
  const statusFilterOption = STATUS_OPTIONS.find(
    (option) => option.value === statusFilter,
  );
  const selectedBooks = books.filter((book) => selectedIds.has(book.id));
  const allVisibleSelected = visible.every((book) => selectedIds.has(book.id));
  const allSelectedStarred =
    selectedBooks.length > 0 && selectedBooks.every((book) => book.starred === true);
  const busy = importing || openingBookId !== null;

  const handleEnterSelect = useCallback((bookId?: string) => {
    setSelectMode(true);
    setSelectedIds(new Set(bookId ? [bookId] : []));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(visible.map((book) => book.id)));
  }, [visible]);

  // Batch curation keeps the selection so several marks can follow in a row.
  const handleBatchStar = () =>
    void updateCuration(selectedBooks, {
      readingStatus: null,
      starred: !allSelectedStarred,
    });

  const handleBatchStatus = (status: ReadingStatus) =>
    void updateCuration(selectedBooks, {
      readingStatus: status,
      starred: null,
    });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (!selectMode || overlayOpen() || isTextEntry(event.target)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        exitSelectMode();
      } else if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        handleSelectAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitSelectMode, handleSelectAll, selectMode]);

  const bookProps = {
    onOpen: onOpenBook,
    onDelete: handleDelete,
    onDetails: setDetailsBook,
    onToggleStar: (target: BookRecord) => void handleToggleStar(target),
    onChangeStatus: (target: BookRecord, status: ReadingStatus) =>
      void handleChangeStatus(target, status),
    deleteDisabled: busy,
    selectMode,
    onToggleSelect: handleToggleSelect,
    onEnterSelect: handleEnterSelect,
    openDisabled: importing,
    statusFilter,
  };

  const sidebarProps = {
    statusFilter,
    counts: statusCounts,
    onStatusFilterChange: handleStatusFilterChange,
    onImport: () => {
      setDrawerOpen(false);
      void handleImport();
    },
    importing,
    trashCount: trashEntries.length,
    onOpenTrash: () => {
      setDrawerOpen(false);
      setTrashOpen(true);
    },
    busy,
  };

  // The sidebar runs the window's full height when docked, so the window's
  // brand row moves into it; otherwise the titlebar carries it.
  const sidebarDocked = loaded && wide && !sidebarCollapsed;
  const brand = (
    <>
      <Button
        size="icon-sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={handleToggleSidebar}
        aria-label={t("library.toggleSidebar")}
        aria-expanded={wide ? !sidebarCollapsed : drawerOpen}
        disabled={!loaded}
      >
        <PanelLeft />
      </Button>
      <h1
        className="select-none text-sm font-medium"
        data-titlebar-drag
        {...titlebarDrag}
      >
        Litera
      </h1>
      <div
        className="min-h-0 min-w-0 flex-1 select-none self-stretch"
        data-titlebar-drag
        {...titlebarDrag}
      />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1">
      {sidebarDocked && (
        <LibrarySidebar
          {...sidebarProps}
          header={
            <div className={cn(titlebarClassName({ bordered: false }), "gap-2")}>
              {brand}
            </div>
          }
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={titlebarClassName({
            bordered: false,
            trafficLightInset: !sidebarDocked,
          })}
        >
          <div className="flex flex-1 basis-0 items-center gap-2 self-stretch">
            {sidebarDocked ? (
              <div
                className="min-h-0 min-w-0 flex-1 select-none self-stretch"
                data-titlebar-drag
                {...titlebarDrag}
              />
            ) : (
              brand
            )}
          </div>
          <div className="relative w-full min-w-32 max-w-md">
            <Input
              ref={searchRef}
              type="text"
              placeholder={t("library.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && e.currentTarget.value) {
                  e.preventDefault();
                  setSearch("");
                }
              }}
              className="peer h-8 w-full pr-14"
            />
            {search ? (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={t("library.clearSearch")}
                onClick={() => {
                  setSearch("");
                  searchRef.current?.focus();
                }}
              >
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[10px] text-muted-foreground peer-focus:hidden"
                aria-hidden
              >
                {detectDesktopOs() === "macos" ? "⌘F" : "Ctrl F"}
              </kbd>
            )}
          </div>
          <div className="flex flex-1 basis-0 items-center justify-end gap-2 self-stretch">
            <div
              className="min-h-0 min-w-0 flex-1 select-none self-stretch"
              data-titlebar-drag
              {...titlebarDrag}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onOpenSettings}
              aria-label={t("library.settings")}
            >
              <Settings />
            </Button>
            <WindowControls />
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          {loaded && !wide && drawerOpen && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t("library.statusFilter")}
              className="absolute inset-0 z-40 flex"
            >
              <LibrarySidebar {...sidebarProps} autoFocus className="shadow-float" />
              <div
                className="flex-1 bg-foreground/20"
                aria-hidden
                onClick={() => setDrawerOpen(false)}
              />
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {books.length > 0 &&
              (selectMode ? (
                <LibrarySelectionBar
                  selectedCount={selectedIds.size}
                  allSelected={allVisibleSelected}
                  onSelectAll={handleSelectAll}
                  allStarred={allSelectedStarred}
                  onToggleStar={handleBatchStar}
                  onMarkAs={handleBatchStatus}
                  onDelete={() => void requestDelete(selectedBooks)}
                  onCancel={exitSelectMode}
                  busy={busy}
                />
              ) : (
                <LibraryShelfToolbar
                  statusFilter={statusFilter}
                  count={visible.length}
                  searching={searching}
                  sort={sort}
                  onSortChange={handleSortChange}
                  order={order}
                  onOrderChange={handleOrderChange}
                  view={view}
                  onViewChange={handleViewChange}
                />
              ))}

            {loadError && (
              <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {t("library.loadFailed", { message: loadError })}
              </div>
            )}

            <BookImportNotices
              notices={notices}
              dismissNotice={dismissNotice}
              onOpenBook={onOpenBook}
              actionDisabled={importing}
            />

            <div className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
              {!loaded || (books.length === 0 && loadError) ? null : books.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center space-y-3">
                    <p className="text-muted-foreground">{t("library.empty")}</p>
                    <p className="text-xs text-muted-foreground">{t("library.dropHint")}</p>
                    <Button
                      onClick={() => void handleImport()}
                      disabled={busy}
                    >
                      <Plus className="size-4" />
                      <span>{importing ? t("library.importing") : t("library.importEpub")}</span>
                    </Button>
                  </div>
                </div>
              ) : visible.length === 0 ? (
                // The status filter is persisted, so a reopened app can land on a
                // narrowed shelf: name the filter and offer a way out.
                <div className="flex h-full items-center justify-center">
                  <div className="text-center space-y-3">
                    <p className="text-muted-foreground">
                      {statusFilterOption && statusFilter !== "all"
                        ? t("library.noMatchesInFilter", {
                            filter: t(statusFilterOption.labelKey),
                          })
                        : t("library.noMatches")}
                    </p>
                    <Button size="sm" variant="outline" onClick={handleClearFilters}>
                      {t("library.clearFilters")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {recents.length > 0 && (
                    <section>
                      <h2 className="mb-1 text-sm font-medium">
                        {t("library.continueReading")}
                      </h2>
                      <div className="-mx-6 flex gap-4 overflow-x-auto px-6 pb-3 pt-1">
                        {recents.map((book) => (
                          <BookResumeTile
                            key={`recent-${book.id}`}
                            book={book}
                            opening={openingBookId === book.id}
                            coverRev={coverRev[book.id]}
                            {...bookProps}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {view === "list" ? (
                    <div data-shelf="main" className="flex flex-col gap-2">
                      {visible.map((book) => (
                        <BookListRow
                          key={book.id}
                          book={book}
                          opening={openingBookId === book.id}
                          selected={selectedIds.has(book.id)}
                          coverRev={coverRev[book.id]}
                          cacheColumn={cacheColumn}
                          {...bookProps}
                        />
                      ))}
                    </div>
                  ) : (
                    <div data-shelf="main" className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">
                      {visible.map((book) => (
                        <BookCard
                          key={book.id}
                          book={book}
                          opening={openingBookId === book.id}
                          selected={selectedIds.has(book.id)}
                          coverRev={coverRev[book.id]}
                          {...bookProps}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <BookDetailsDialog
        book={detailsBook}
        coverRev={detailsBook ? coverRev[detailsBook.id] : undefined}
        open={detailsBook !== null}
        onOpenChange={(open) => {
          if (!open) setDetailsBook(null);
        }}
        onSaved={handleDetailsSaved}
      />

      <TrashDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        entries={trashEntries}
        onRestore={(entry) => void handleRestoreEntry(entry)}
        onPurge={(entry) => void handlePurgeEntry(entry)}
        onPurgeAll={() => void handlePurgeAll()}
      />

      <BookImportConfirmDialog
        confirmOpen={confirmOpen}
        confirmRequest={confirmRequest}
        settleConfirm={settleConfirm}
      />
    </div>
  );
}
