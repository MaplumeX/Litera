import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notifySyncActivity } from "@/lib/sync-activity";
import type { ImportBookResult } from "@/types/library";
import { invokeErrorMessage, isInvokeAppError } from "@/lib/app-error";
import {
  type ConfirmRequest,
  type ImportNotice,
  importAbsolutePaths,
  importIncomingBooks,
  processImportResults,
} from "@/lib/book-import";
import { platformBridge, type IncomingBook } from "@/lib/platform-bridge";
import { t } from "@/lib/i18n";

/** Imports the app started on the reader's behalf ("Open with") open the Book instead of noting a duplicate. */
interface ImportOptions {
  suppressDuplicateNotice?: boolean;
}

export interface BookImportNotice extends ImportNotice {
  id: string;
}

export function useBookImport() {
  const [notices, setNotices] = useState<BookImportNotice[]>([]);
  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const importingRef = useRef(false);

  const pushNotice = useCallback((notice: ImportNotice) => {
    setNotices((current) => [...current, { ...notice, id: crypto.randomUUID() }]);
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

  const runIncoming = useCallback(
    async (books: IncomingBook[], options?: ImportOptions) => {
      if (books.length === 0) return [];
      const ids = await importIncomingBooks(books, {
        askConfirm,
        onNotice: pushNotice,
        suppressDuplicateNotice: options?.suppressDuplicateNotice,
      });
      if (ids.length > 0) notifySyncActivity({ prompt: true });
      return ids;
    },
    [askConfirm, pushNotice],
  );

  /**
   * Books from an "Open with" or a share. They are never dropped while
   * another import runs: the platform already copied them into the cache.
   */
  const importIncoming = useCallback(
    async (books: IncomingBook[], options?: ImportOptions) => {
      setImporting(true);
      try {
        return await runIncoming(books, options);
      } finally {
        setImporting(importingRef.current);
      }
    },
    [runIncoming],
  );

  const importFromPicker = useCallback(async () => {
    if (importingRef.current) return [];
    importingRef.current = true;
    setImporting(true);
    try {
      if (platformBridge.hasDocumentPicker) {
        return await runIncoming(await platformBridge.pickBooks());
      }
      const results = await invoke<ImportBookResult[]>("import_book");
      if (results.length > 0) notifySyncActivity({ prompt: true });
      return await processImportResults(results, {
        askConfirm,
        onNotice: pushNotice,
      });
    } catch (err) {
      if (
        (isInvokeAppError(err) && err.code === "Cancelled") ||
        String(err).includes("No file selected")
      ) {
        return [];
      }
      console.error("import error:", err);
      pushNotice({
        kind: "error",
        message: t("library.importFailed", { message: invokeErrorMessage(err) }),
      });
      return [];
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [askConfirm, pushNotice, runIncoming]);

  const importFromPaths = useCallback(
    async (paths: string[], options?: ImportOptions) => {
      if (importingRef.current) return [];
      importingRef.current = true;
      setImporting(true);
      try {
        return await importAbsolutePaths(paths, {
          askConfirm,
          onNotice: pushNotice,
          suppressDuplicateNotice: options?.suppressDuplicateNotice,
        });
      } finally {
        importingRef.current = false;
        setImporting(false);
      }
    },
    [askConfirm, pushNotice],
  );

  return {
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
  };
}
