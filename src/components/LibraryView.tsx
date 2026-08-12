import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BookRecord, ImportBookResult } from "@/types/library";
import { extractEpubMetadata } from "@/lib/book-utils";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { BookCard } from "@/components/BookCard";
import {
  invokeErrorMessage,
  isInvokeAppError,
} from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";

interface LibraryViewProps {
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId?: string | null;
}

export function LibraryView({ onOpenBook, openingBookId = null }: LibraryViewProps) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
    if (importing) return;
    setImporting(true);
    try {
      // 1. Rust picks and stages the file, returning only lightweight metadata.
      const result = await invoke<ImportBookResult>("import_book");
      // 2. Fetch the staged EPUB through Raw IPC, then extract metadata offscreen.
      const buffer = await invoke<ArrayBuffer>("read_import_bytes", {
        bookId: result.bookId,
        importId: result.importId,
      });
      const metadata = await extractEpubMetadata(epubBytesFromIpc(buffer), result.name);
      // 3. Save metadata + cover to app data via Rust.
      await invoke<BookRecord>("save_book_metadata", {
        bookId: result.bookId,
        title: metadata.title,
        author: metadata.author,
        coverBytes: metadata.coverBytes ?? null,
        importId: result.importId,
      });
      // 4. Refresh the grid.
      await refreshBooks();
    } catch (err) {
      if (
        (isInvokeAppError(err) && err.code === "Cancelled") ||
        String(err).includes("No file selected")
      ) {
        // User cancelled — no error.
      } else {
        console.error("import error:", err);
        alert(`导入失败: ${invokeErrorMessage(err)}`);
      }
    } finally {
      setImporting(false);
    }
  }, [importing, refreshBooks]);

  const handleDelete = useCallback(
    async (bookId: string) => {
      try {
        await invoke("delete_book", { bookId });
        await refreshBooks();
      } catch (err) {
        console.error("delete error:", err);
        alert(`删除失败: ${invokeErrorMessage(err)}`);
      }
    },
    [refreshBooks],
  );

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-bold">Litera</h1>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="搜索书名或作者…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            onClick={() => void handleImport()}
            disabled={importing || openingBookId !== null}
          >
            <Plus className="size-4" />
            <span>{importing ? "导入中…" : "导入"}</span>
          </Button>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          书库加载失败：{loadError}
        </div>
      )}

      {/* Grid or empty state */}
      <div className="flex-1 overflow-y-auto p-4">
        {books.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <p className="text-muted-foreground">还没有书籍</p>
              <Button
                onClick={() => void handleImport()}
                disabled={importing || openingBookId !== null}
              >
                <Plus className="size-4" />
                <span>{importing ? "导入中…" : "导入 EPUB"}</span>
              </Button>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">没有匹配的书籍</p>
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
                deleteDisabled={openingBookId !== null}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
