import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BookRecord, TrashEntry } from "@/types/library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WindowControls,
  titlebarClassName,
  useTitlebarWindowDrag,
} from "@/components/WindowControls";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Plus, Settings, Trash2 } from "lucide-react";
import { BookCard, BookListRow } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import { TrashDialog } from "@/components/TrashDialog";
import type { BookStatusChoice } from "@/components/BookStatusMenu";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { invokeErrorMessage } from "@/lib/app-error";
import { notifySyncActivity } from "@/lib/sync-activity";
import { useBookImport } from "@/lib/use-book-import";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  filterBooks,
  filterByStatus,
  isLibraryStatusFilter,
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

interface LibraryViewProps {
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId?: string | null;
  onOpenSettings: () => void;
}

function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith(".epub");
}

const SORT_OPTIONS: { value: LibrarySortKey; labelKey: MessageKey }[] = [
  { value: "recent", labelKey: "library.sort.recent" },
  { value: "title", labelKey: "library.sort.title" },
  { value: "author", labelKey: "library.sort.author" },
  { value: "imported", labelKey: "library.sort.imported" },
  { value: "progress", labelKey: "library.sort.progress" },
];

const STATUS_OPTIONS: { value: LibraryStatusFilter; labelKey: MessageKey }[] = [
  { value: "all", labelKey: "library.status.all" },
  { value: "unread", labelKey: "library.status.unread" },
  { value: "reading", labelKey: "library.status.reading" },
  { value: "finished", labelKey: "library.status.finished" },
  { value: "starred", labelKey: "library.status.starred" },
];

export function LibraryView({ onOpenBook, openingBookId = null, onOpenSettings }: LibraryViewProps) {
  const { t } = useT();
  const titlebarDrag = useTitlebarWindowDrag();
  const [books, setBooks] = useState<BookRecord[]>([]);
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

  const handleOrderToggle = useCallback(() => {
    const next: LibrarySortOrder = order === "asc" ? "desc" : "asc";
    setOrder(next);
    saveLibrarySortOrder(next);
  }, [order]);

  const handleViewChange = useCallback((next: LibraryViewMode) => {
    setView(next);
    saveLibraryView(next);
  }, []);

  const handleStatusFilterChange = useCallback((value: string) => {
    if (!isLibraryStatusFilter(value)) return;
    setStatusFilter(value);
    saveLibraryStatusFilter(value);
  }, []);

  const handleToggleStar = useCallback(
    async (target: BookRecord) => {
      try {
        // Curation has its own command so starring never rewrites the
        // metadata fields the details dialog owns.
        const updated = await invoke<BookRecord>("update_book_curation", {
          bookId: target.id,
          readingStatus: null,
          starred: target.starred !== true,
        });
        setBooks((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        notifySyncActivity();
      } catch (err) {
        console.error("update_book_curation error:", err);
        pushNotice({
          kind: "error",
          message: t("library.curationFailed", { message: invokeErrorMessage(err) }),
        });
      }
    },
    [pushNotice, t],
  );

  const handleChangeStatus = useCallback(
    async (target: BookRecord, status: BookStatusChoice) => {
      try {
        const updated = await invoke<BookRecord>("update_book_curation", {
          bookId: target.id,
          // An empty string clears the status; null would mean "leave alone".
          readingStatus: status === "unset" ? "" : status,
          starred: null,
        });
        setBooks((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
        notifySyncActivity();
      } catch (err) {
        console.error("update_book_curation error:", err);
        pushNotice({
          kind: "error",
          message: t("library.curationFailed", { message: invokeErrorMessage(err) }),
        });
      }
    },
    [pushNotice, t],
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
  const recents = useMemo(
    // Continue reading narrows with the status filter like the main grid: a
    // reader looking at "unread" should not be shown finished books up top.
    () => (searching ? [] : takeRecent(filterByStatus(books, statusFilter))),
    [books, searching, statusFilter],
  );
  const visible = useMemo(
    () =>
      sortBooks(
        filterByStatus(filterBooks(books, search), statusFilter),
        sort,
        order,
      ),
    [books, order, search, sort, statusFilter],
  );
  const selectedBooks = books.filter((book) => selectedIds.has(book.id));
  const busy = importing || openingBookId !== null;

  const bookProps = {
    onOpen: onOpenBook,
    onDelete: handleDelete,
    onDetails: setDetailsBook,
    onToggleStar: (target: BookRecord) => void handleToggleStar(target),
    onChangeStatus: (target: BookRecord, status: BookStatusChoice) =>
      void handleChangeStatus(target, status),
    deleteDisabled: busy,
    selectMode,
    onToggleSelect: handleToggleSelect,
    openDisabled: importing,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className={titlebarClassName()}>
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
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
          />
          {books.length > 0 && (
            <>
              <Select
                value={statusFilter}
                onValueChange={handleStatusFilterChange}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-[7.5rem]"
                  aria-label={t("library.statusFilter")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={handleSortChange}>
                <SelectTrigger
                  size="sm"
                  className="h-8 w-[8.75rem]"
                  aria-label={t("library.sort")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={
                  order === "asc"
                    ? t("library.sortAscending")
                    : t("library.sortDescending")
                }
                aria-pressed={order === "desc"}
                data-sort-order={order}
                onClick={handleOrderToggle}
              >
                {order === "asc" ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
              </Button>
              <div className="flex items-center">
                <Button
                  type="button"
                  size="icon-sm"
                  variant={view === "grid" ? "secondary" : "ghost"}
                  aria-label={t("library.viewGrid")}
                  aria-pressed={view === "grid"}
                  onClick={() => handleViewChange("grid")}
                >
                  <LayoutGrid />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant={view === "list" ? "secondary" : "ghost"}
                  aria-label={t("library.viewList")}
                  aria-pressed={view === "list"}
                  onClick={() => handleViewChange("list")}
                >
                  <List />
                </Button>
              </div>
            </>
          )}
          {selectMode ? (
            <>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("library.selectedCount", { count: selectedIds.size })}
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={selectedIds.size === 0 || busy}
                onClick={() => void requestDelete(selectedBooks)}
              >
                {t("common.delete")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exitSelectMode}
              >
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() => void handleImport()}
                disabled={busy}
              >
                <Plus className="size-4" />
                <span>{importing ? t("library.importing") : t("library.import")}</span>
              </Button>
              {books.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectMode(true)}
                  disabled={busy}
                >
                  {t("library.select")}
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onOpenSettings}
                aria-label={t("library.settings")}
              >
                <Settings />
              </Button>
              {trashEntries.length > 0 && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("library.trash")}
                  data-trash-count={trashEntries.length}
                  onClick={() => setTrashOpen(true)}
                  disabled={busy}
                >
                  <Trash2 />
                </Button>
              )}
            </>
          )}
        </div>
        <WindowControls />
      </header>

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

      <div className="flex-1 overflow-y-auto p-4">
        {books.length === 0 ? (
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
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">{t("library.noMatches")}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {recents.length > 0 && (
              <section className="border-b pb-6">
                <h2 className="mb-3 text-sm font-medium">
                  {t("library.continueReading")}
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">
                  {recents.map((book) => (
                    <BookCard
                      key={`recent-${book.id}`}
                      book={book}
                      opening={openingBookId === book.id}
                      selected={selectedIds.has(book.id)}
                      showMenu={false}
                      showDelete={false}
                      coverRev={coverRev[book.id]}
                      {...bookProps}
                    />
                  ))}
                </div>
              </section>
            )}
            {view === "list" ? (
              <div className="flex flex-col gap-2">
                {visible.map((book) => (
                  <BookListRow
                    key={book.id}
                    book={book}
                    opening={openingBookId === book.id}
                    selected={selectedIds.has(book.id)}
                    coverRev={coverRev[book.id]}
                    {...bookProps}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">
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
