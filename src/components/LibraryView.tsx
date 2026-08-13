import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BookRecord, ImportBookResult } from "@/types/library";
import { extractEpubMetadata } from "@/lib/book-utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Settings } from "lucide-react";
import { BookCard } from "@/components/BookCard";
import {
  invokeErrorMessage,
  isInvokeAppError,
} from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";

interface LibraryViewProps {
  onOpenBook: (bookId: string) => void | Promise<void>;
  openingBookId?: string | null;
  onOpenSettings: () => void;
}

interface Notice {
  id: string;
  kind: "error" | "info";
  message: string;
  action?: { label: string; bookId: string };
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

function isEpubPath(path: string): boolean {
  return path.toLowerCase().endsWith(".epub");
}

export function LibraryView({ onOpenBook, openingBookId = null, onOpenSettings }: LibraryViewProps) {
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const importingRef = useRef(false);

  const pushNotice = useCallback((notice: Omit<Notice, "id">) => {
    setNotices((current) => [
      ...current,
      { ...notice, id: crypto.randomUUID() },
    ]);
  }, []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const settleConfirm = useCallback((value: boolean) => {
    const resolve = confirmResolver.current;
    confirmResolver.current = null;
    setConfirmOpen(false);
    resolve?.(value);
  }, []);

  const askConfirm = useCallback((request: ConfirmRequest) => {
    setConfirmRequest(request);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  useEffect(() => {
    return () => {
      settleConfirm(false);
    };
  }, [settleConfirm]);

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

  const commitStagedImport = useCallback(async (result: ImportBookResult) => {
    if (!result.importId) {
      throw new Error("Missing importId for staged import");
    }
    const buffer = await invoke<ArrayBuffer>("read_import_bytes", {
      bookId: result.bookId,
      importId: result.importId,
    });
    const metadata = await extractEpubMetadata(epubBytesFromIpc(buffer), result.name);
    await invoke<BookRecord>("save_book_metadata", {
      bookId: result.bookId,
      title: metadata.title,
      author: metadata.author,
      coverBytes: metadata.coverBytes ?? null,
      importId: result.importId,
    });
  }, []);

  const processImportResults = useCallback(async (results: ImportBookResult[]) => {
    for (const result of results) {
      if (result.status === "duplicate") {
        pushNotice({
          kind: "info",
          message: `《${result.title}》已在书库`,
          action: { label: "打开", bookId: result.bookId },
        });
        continue;
      }
      if (result.status === "overwrite") {
        const confirmed = await askConfirm({
          title: `覆盖「${result.title}」？`,
          description: "将用新文件替换这本书。阅读进度、设置和对话会保留。",
          confirmLabel: "覆盖",
        });
        if (!confirmed) {
          if (result.importId) {
            try {
              await invoke("discard_import", {
                bookId: result.bookId,
                importId: result.importId,
              });
            } catch (err) {
              console.error("discard_import error:", err);
              pushNotice({
                kind: "error",
                message: `取消覆盖失败：${invokeErrorMessage(err)}`,
              });
            }
          }
          continue;
        }
      }
      try {
        await commitStagedImport(result);
      } catch (err) {
        console.error("import commit error:", err);
        pushNotice({
          kind: "error",
          message: `导入失败：${invokeErrorMessage(err)}`,
        });
      }
    }
    await refreshBooks();
  }, [askConfirm, commitStagedImport, pushNotice, refreshBooks]);

  const handleImport = useCallback(async () => {
    if (importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      const results = await invoke<ImportBookResult[]>("import_book");
      await processImportResults(results);
    } catch (err) {
      if (
        (isInvokeAppError(err) && err.code === "Cancelled") ||
        String(err).includes("No file selected")
      ) {
        // User cancelled — no error.
      } else {
        console.error("import error:", err);
        pushNotice({
          kind: "error",
          message: `导入失败：${invokeErrorMessage(err)}`,
        });
      }
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [processImportResults, pushNotice]);

  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const epubs = paths.filter(isEpubPath);
    if (epubs.length === 0 || importingRef.current) return;
    importingRef.current = true;
    setImporting(true);
    try {
      // One file at a time so a confirmed overwrite hash is visible to the
      // next path (same-batch overwrite-then-duplicate) and a later failure
      // still lets earlier files finish metadata commit.
      for (const path of epubs) {
        try {
          const results = await invoke<ImportBookResult[]>("import_paths", {
            paths: [path],
          });
          await processImportResults(results);
        } catch (err) {
          console.error("import_paths error:", err);
          pushNotice({
            kind: "error",
            message: `导入失败：${invokeErrorMessage(err)}`,
          });
        }
      }
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [processImportResults, pushNotice]);

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
        ? `删除「${targets[0].title}」？`
        : `删除 ${targets.length} 本书？`,
      description: single
        ? "将删除该书的 AI 对话，此操作无法撤销。"
        : "将删除这些书的 AI 对话，此操作无法撤销。",
      confirmLabel: "删除",
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
        message: `删除失败：${failures.join("、")}`,
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
          {selectMode ? (
            <>
              <span className="text-sm text-muted-foreground tabular-nums">
                已选 {selectedIds.size}
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={selectedIds.size === 0 || busy}
                onClick={() => void requestDelete(selectedBooks)}
              >
                删除
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={exitSelectMode}
              >
                取消
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
                <span>{importing ? "导入中…" : "导入"}</span>
              </Button>
              {books.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectMode(true)}
                  disabled={busy}
                >
                  选择
                </Button>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onOpenSettings}
                aria-label="设置"
              >
                <Settings />
              </Button>
            </>
          )}
        </div>
      </header>

      {loadError && (
        <div role="alert" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          书库加载失败：{loadError}
        </div>
      )}

      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.kind === "error" ? "alert" : "status"}
          className={
            notice.kind === "error"
              ? "flex items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive"
              : "flex items-center gap-3 border-b bg-muted/60 px-4 py-2 text-sm"
          }
        >
          <span className="min-w-0 flex-1">{notice.message}</span>
          {notice.action && (
            <Button
              size="sm"
              variant="ghost"
              disabled={importing}
              onClick={() => {
                dismissNotice(notice.id);
                void onOpenBook(notice.action!.bookId);
              }}
            >
              {notice.action.label}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dismissNotice(notice.id)}
          >
            关闭
          </Button>
        </div>
      ))}

      {/* Grid or empty state */}
      <div className="flex-1 overflow-y-auto p-4">
        {books.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-3">
              <p className="text-muted-foreground">还没有书籍</p>
              <p className="text-xs text-muted-foreground">或将 EPUB 拖入此窗口</p>
              <Button
                onClick={() => void handleImport()}
                disabled={busy}
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

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) settleConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmRequest?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmRequest?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant={confirmRequest?.destructive ? "destructive" : "default"}
              onClick={() => settleConfirm(true)}
            >
              {confirmRequest?.confirmLabel ?? "确定"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
