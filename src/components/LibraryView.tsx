import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BookRecord } from "@/types/library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WindowControls,
  onTitlebarDragMouseDown,
  titlebarClassName,
} from "@/components/WindowControls";
import { Plus, Settings } from "lucide-react";
import { BookCard } from "@/components/BookCard";
import {
  BookImportConfirmDialog,
  BookImportNotices,
} from "@/components/BookImportFeedback";
import { invokeErrorMessage } from "@/lib/app-error";
import { useBookImport } from "@/lib/use-book-import";
import { useT } from "@/lib/i18n";

interface LibraryViewProps {
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId?: string | null;
  onOpenSettings: () => void;
}

function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith(".epub");
}

export function LibraryView({ onOpenBook, openingBookId = null, onOpenSettings }: LibraryViewProps) {
  const { t } = useT();
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Load books from the library on mount.
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
    // One file at a time so a confirmed overwrite hash is visible to the
    // next path (same-batch overwrite-then-duplicate) and a later failure
    // still lets earlier files finish metadata commit.
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
  }, [askConfirm, exitSelectMode, pushNotice, refreshBooks, selectMode]);

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

  // Filter books by search query (title or author).
  const filtered = search.trim()
    ? books.filter((b) => {
        const q = search.toLowerCase();
        return (
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q)
        );
      })
    : books;
  const selectedBooks = books.filter((book) => selectedIds.has(book.id));
  const busy = importing || openingBookId !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <header className={titlebarClassName()}>
        <h1
          className="select-none text-lg font-semibold"
          data-tauri-drag-region
          onMouseDown={onTitlebarDragMouseDown}
        >
          Litera
        </h1>
        <div
          className="min-h-0 min-w-0 flex-1 select-none self-stretch"
          data-tauri-drag-region
          onMouseDown={onTitlebarDragMouseDown}
        />
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder={t("library.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
          />
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

      {/* Grid or empty state */}
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
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">{t("library.noMatches")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">
            {filtered.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                onOpen={onOpenBook}
                onDelete={handleDelete}
                opening={openingBookId === book.id}
                deleteDisabled={busy}
                selectMode={selectMode}
                selected={selectedIds.has(book.id)}
                onToggleSelect={handleToggleSelect}
                openDisabled={importing}
              />
            ))}
          </div>
        )}
      </div>

      <BookImportConfirmDialog
        confirmOpen={confirmOpen}
        confirmRequest={confirmRequest}
        settleConfirm={settleConfirm}
      />
    </div>
  );
}
