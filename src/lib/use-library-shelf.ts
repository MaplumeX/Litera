import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BookRecord, ReadingStatus, TrashEntry } from "@/types/library";
import { STATUS_OPTIONS } from "@/components/LibraryShelfToolbar";
import { invokeErrorMessage } from "@/lib/app-error";
import { notifySyncActivity } from "@/lib/sync-activity";
import { useBookImport } from "@/lib/use-book-import";
import { useT } from "@/lib/i18n";
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
  loadLibrarySort,
  loadLibrarySortOrder,
  loadLibraryStatusFilter,
  loadLibraryView,
  parseLibrarySort,
  saveLibrarySort,
  saveLibrarySortOrder,
  saveLibraryStatusFilter,
  saveLibraryView,
  type LibraryViewMode,
} from "@/lib/library-shelf-prefs";

/** `update_book_curation` arguments: null leaves a field alone. */
interface CurationChange {
  readingStatus: string | null;
  starred: boolean | null;
}

/**
 * The Library shelf both shells render: the books, search / sort / filter /
 * view, curation, deletion and the Trash, imports and their feedback, and
 * on-demand covers for synced books.
 */
export function useLibraryShelf({ openingBookId = null }: { openingBookId?: string | null } = {}) {
  const { t } = useT();
  const [books, setBooks] = useState<BookRecord[]>([]);
  // Until the first list_books settles, an empty `books` means "not read yet",
  // not "empty library": rendering the empty state then would flash it.
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
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
  const [detailsBook, setDetailsBook] = useState<BookRecord | null>(null);
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
    importIncoming,
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

  // Books without a local cover: fetch it on demand the first time the
  // shelf renders them, so a new device's shelf looks right without
  // downloading whole books. Downloaded books are included too: a legacy
  // book's cover may reach the Sync Backend only after its EPUB already
  // came down here. Attempted once per book per session; failures are
  // silent (sync may not be configured, or the book has no cover).
  const coverAttemptsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = books.filter(
      (book) =>
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
        notifySyncActivity({ prompt: true });
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
  }, []);

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
        notifySyncActivity({ prompt: true });
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
        notifySyncActivity({ prompt: true });
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
  // Continue reading is a fixed entry point, so it stays up whatever the sort,
  // even when it repeats the shelf's first row; only searching or selecting
  // hides it.
  const showRecents = !searching && !selectMode;
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


  return {
    books,
    loaded,
    loadError,
    refreshBooks,
    search,
    setSearch,
    searching,
    sort,
    order,
    view,
    statusFilter,
    statusFilterOption,
    statusCounts,
    visible,
    recents,
    cacheColumn,
    handleSortChange,
    handleOrderChange,
    handleViewChange,
    handleStatusFilterChange,
    handleClearFilters,
    // Selection
    selectMode,
    selectedIds,
    selectedBooks,
    allVisibleSelected,
    allSelectedStarred,
    exitSelectMode,
    handleEnterSelect,
    handleSelectAll,
    handleToggleSelect,
    handleBatchStar,
    handleBatchStatus,
    // Book actions
    requestDelete,
    handleDelete,
    handleToggleStar,
    handleChangeStatus,
    detailsBook,
    setDetailsBook,
    coverRev,
    handleDetailsSaved,
    // Trash
    trashEntries,
    handleRestoreEntry,
    handlePurgeEntry,
    handlePurgeAll,
    // Import
    importing,
    importingRef,
    importFromPaths,
    importIncoming,
    handleImport,
    notices,
    dismissNotice,
    confirmOpen,
    confirmRequest,
    settleConfirm,
    askConfirm,
    pushNotice,
    busy,
  };
}

export type LibraryShelf = ReturnType<typeof useLibraryShelf>;
