import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BookRecord } from "@/types/library";
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
import { LayoutGrid, List, Plus, Settings } from "lucide-react";
import { BookCard, BookListRow } from "@/components/BookCard";
import { BookDetailsDialog } from "@/components/BookDetailsDialog";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { invokeErrorMessage } from "@/lib/app-error";
import { useBookImport } from "@/lib/use-book-import";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  filterBooks,
  sortBooks,
  takeRecent,
  type LibrarySortKey,
} from "@/lib/library-shelf";
import {
  loadLibrarySort,
  loadLibraryView,
  parseLibrarySort,
  saveLibrarySort,
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

export function LibraryView({ onOpenBook, openingBookId = null, onOpenSettings }: LibraryViewProps) {
  const { t } = useT();
  const titlebarDrag = useTitlebarWindowDrag();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<LibrarySortKey>(loadLibrarySort);
  const [view, setView] = useState<LibraryViewMode>(loadLibraryView);
  const [detailsBook, setDetailsBook] = useState<BookRecord | null>(null);
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
      } catch (err) {
        console.error("delete error:", err);
        failures.push(book.title);
      }
    }
    await refreshBooks();
    if (selectMode) exitSelectMode();
    if (failures.length > 0) {
      pushNotice({
        kind: "error",
        message: t("library.deleteFailed", { titles: failures.join(t("common.listJoin")) }),
      });
    }
  }, [askConfirm, exitSelectMode, pushNotice, refreshBooks, selectMode, t]);

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
    setSort(next);
    saveLibrarySort(next);
  }, []);

  const handleViewChange = useCallback((next: LibraryViewMode) => {
    setView(next);
    saveLibraryView(next);
  }, []);

  const handleDetailsSaved = useCallback((record: BookRecord, coverChanged: boolean) => {
    setBooks((current) =>
      current.map((item) => (item.id === record.id ? record : item)),
    );
    if (coverChanged) {
      setCoverRev((current) => ({ ...current, [record.id]: Date.now() }));
    }
  }, []);

  const searching = search.trim().length > 0;
  const recents = useMemo(
    () => (searching ? [] : takeRecent(books)),
    [books, searching],
  );
  const visible = useMemo(
    () => sortBooks(filterBooks(books, search), sort),
    [books, search, sort],
  );
  const selectedBooks = books.filter((book) => selectedIds.has(book.id));
  const busy = importing || openingBookId !== null;

  const bookProps = {
    onOpen: onOpenBook,
    onDelete: handleDelete,
    onDetails: setDetailsBook,
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

      <BookImportConfirmDialog
        confirmOpen={confirmOpen}
        confirmRequest={confirmRequest}
        settleConfirm={settleConfirm}
      />
    </div>
  );
}
