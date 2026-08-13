import { invoke } from "@tauri-apps/api/core";
import type { BookRecord, ImportBookResult } from "@/types/library";
import { extractEpubMetadata } from "@/lib/book-utils";
import { invokeErrorMessage } from "@/lib/app-error";
import { epubBytesFromIpc } from "@/lib/ipc-bytes";

export interface ImportNotice {
  kind: "error" | "info";
  message: string;
  action?: { label: string; bookId: string };
}

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
}

export interface ProcessImportDeps {
  askConfirm: (request: ConfirmRequest) => Promise<boolean>;
  onNotice: (notice: ImportNotice) => void;
}

export async function commitStagedImport(result: ImportBookResult): Promise<void> {
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
}

async function discardStagedImport(
  result: ImportBookResult,
  onNotice: ProcessImportDeps["onNotice"],
): Promise<void> {
  if (!result.importId) return;
  try {
    await invoke("discard_import", {
      bookId: result.bookId,
      importId: result.importId,
    });
  } catch (err) {
    console.error("discard_import error:", err);
    onNotice({
      kind: "error",
      message: `取消覆盖失败：${invokeErrorMessage(err)}`,
    });
  }
}

export async function processImportResults(
  results: ImportBookResult[],
  deps: ProcessImportDeps,
): Promise<string[]> {
  const successfulBookIds: string[] = [];
  for (const result of results) {
    if (result.status === "duplicate") {
      deps.onNotice({
        kind: "info",
        message: `《${result.title}》已在书库`,
        action: { label: "打开", bookId: result.bookId },
      });
      successfulBookIds.push(result.bookId);
      continue;
    }
    if (result.status === "overwrite") {
      const confirmed = await deps.askConfirm({
        title: `覆盖「${result.title}」？`,
        description: "将用新文件替换这本书。阅读进度、设置和对话会保留。",
        confirmLabel: "覆盖",
      });
      if (!confirmed) {
        await discardStagedImport(result, deps.onNotice);
        continue;
      }
    }
    try {
      await commitStagedImport(result);
      successfulBookIds.push(result.bookId);
    } catch (err) {
      console.error("import commit error:", err);
      deps.onNotice({
        kind: "error",
        message: `导入失败：${invokeErrorMessage(err)}`,
      });
    }
  }
  return successfulBookIds;
}

export function uniqueAbsolutePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  return unique;
}

export async function importAbsolutePaths(
  paths: string[],
  deps: ProcessImportDeps,
): Promise<string[]> {
  const successfulBookIds: string[] = [];
  for (const path of uniqueAbsolutePaths(paths)) {
    try {
      const results = await invoke<ImportBookResult[]>("import_paths", {
        paths: [path],
      });
      const ids = await processImportResults(results, deps);
      successfulBookIds.push(...ids);
    } catch (err) {
      console.error("import_paths error:", err);
      deps.onNotice({
        kind: "error",
        message: `导入失败：${invokeErrorMessage(err)}`,
      });
    }
  }
  return successfulBookIds;
}
