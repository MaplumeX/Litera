import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ImportBookResult } from "@/types/library";
import { invokeErrorMessage, isInvokeAppError } from "@/lib/app-error";
import {
  type ConfirmRequest,
  type ImportNotice,
  importAbsolutePaths,
  processImportResults,
} from "@/lib/book-import";

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

  const importFromPicker = useCallback(async () => {
    if (importingRef.current) return [];
    importingRef.current = true;
    setImporting(true);
    try {
      const results = await invoke<ImportBookResult[]>("import_book");
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
        message: `导入失败：${invokeErrorMessage(err)}`,
      });
      return [];
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  }, [askConfirm, pushNotice]);

  const importFromPaths = useCallback(
    async (paths: string[]) => {
      if (importingRef.current) return [];
      importingRef.current = true;
      setImporting(true);
      try {
        return await importAbsolutePaths(paths, {
          askConfirm,
          onNotice: pushNotice,
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
  };
}
