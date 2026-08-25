import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ImportBookResult } from "@/types/library";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock("@/lib/book-utils", () => ({
  extractEpubMetadata: vi.fn(async () => ({
    title: "Extracted Title",
    author: "Extracted Author",
    description: "A summary",
    publisher: "Pub",
    language: "en",
    series: "Saga · 1",
    coverBytes: null,
  })),
}));

import { importAbsolutePaths, processImportResults } from "./book-import";

function setupInvoke(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  invokeMock.mockImplementation((cmd: string, args?: unknown) => {
    if (cmd in handlers) {
      return Promise.resolve(handlers[cmd](args));
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  setupInvoke();
});

describe("processImportResults", () => {
  it("treats duplicate as success without saving", async () => {
    const onNotice = vi.fn();
    const duplicate: ImportBookResult = {
      status: "duplicate",
      bookId: "book-1",
      title: "Stored Title",
      name: "copy.epub",
    };

    const ids = await processImportResults([duplicate], {
      askConfirm: vi.fn(),
      onNotice,
    });

    expect(ids).toEqual(["book-1"]);
    expect(onNotice).toHaveBeenCalledWith({
      kind: "info",
      message: "《Stored Title》已在书库",
      action: { label: "打开", bookId: "book-1" },
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
  });

  it("suppresses the duplicate notice but still returns the book id", async () => {
    const onNotice = vi.fn();
    const duplicate: ImportBookResult = {
      status: "duplicate",
      bookId: "book-1",
      title: "Stored Title",
      name: "copy.epub",
    };

    const ids = await processImportResults([duplicate], {
      askConfirm: vi.fn(),
      onNotice,
      suppressDuplicateNotice: true,
    });

    expect(ids).toEqual(["book-1"]);
    expect(onNotice).not.toHaveBeenCalled();
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
  });

  it("discards an overwrite when the user cancels", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-1",
      title: "Stored Title",
      importId: "imp-1",
      name: "book.epub",
    };
    setupInvoke({ discard_import: () => undefined });

    const ids = await processImportResults([overwrite], {
      askConfirm: async () => false,
      onNotice: vi.fn(),
    });

    expect(ids).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("discard_import", {
      bookId: "book-1",
      importId: "imp-1",
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
  });

  it("commits a new import with extracted extra metadata", async () => {
    const created: ImportBookResult = {
      status: "new",
      bookId: "book-1",
      title: "book.epub",
      importId: "imp-1",
      name: "book.epub",
    };
    setupInvoke({
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => ({ id: "book-1" }),
    });

    const ids = await processImportResults([created], {
      askConfirm: vi.fn(),
      onNotice: vi.fn(),
    });

    expect(ids).toEqual(["book-1"]);
    expect(invokeMock).toHaveBeenCalledWith("save_book_metadata", {
      bookId: "book-1",
      title: "Extracted Title",
      author: "Extracted Author",
      description: "A summary",
      publisher: "Pub",
      language: "en",
      series: "Saga · 1",
      coverBytes: null,
      importId: "imp-1",
    });
  });

  it("commits an overwrite after confirm", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-1",
      title: "Stored Title",
      importId: "imp-1",
      name: "book.epub",
    };
    setupInvoke({
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => ({ id: "book-1" }),
    });

    const ids = await processImportResults([overwrite], {
      askConfirm: async () => true,
      onNotice: vi.fn(),
    });

    expect(ids).toEqual(["book-1"]);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_book_metadata",
      expect.objectContaining({
        bookId: "book-1",
        importId: "imp-1",
        title: "Extracted Title",
        description: "A summary",
        publisher: "Pub",
        language: "en",
        series: "Saga · 1",
      }),
    );
  });

  it("keeps later files after a cancelled overwrite", async () => {
    const overwrite: ImportBookResult = {
      status: "overwrite",
      bookId: "book-a",
      title: "Old Book",
      importId: "imp-a",
      name: "a.epub",
    };
    const created: ImportBookResult = {
      status: "new",
      bookId: "book-b",
      title: "b.epub",
      importId: "imp-b",
      name: "b.epub",
    };
    setupInvoke({
      discard_import: () => undefined,
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => ({ id: "book-b" }),
    });

    const ids = await processImportResults([overwrite, created], {
      askConfirm: async () => false,
      onNotice: vi.fn(),
    });

    expect(ids).toEqual(["book-b"]);
    expect(invokeMock).toHaveBeenCalledWith("discard_import", {
      bookId: "book-a",
      importId: "imp-a",
    });
  });
});

describe("importAbsolutePaths", () => {
  it("imports one path at a time and returns the last success", async () => {
    const seen: string[][] = [];
    setupInvoke({
      import_paths: (args) => {
        const paths = (args as { paths: string[] }).paths;
        seen.push(paths);
        if (paths[0] === "/tmp/a.epub") {
          return [{
            status: "new",
            bookId: "book-a",
            title: "a.epub",
            importId: "imp-a",
            name: "a.epub",
          }] satisfies ImportBookResult[];
        }
        return [{
          status: "duplicate",
          bookId: "book-b",
          title: "Stored",
          name: "b.epub",
        }] satisfies ImportBookResult[];
      },
      read_import_bytes: () => new ArrayBuffer(8),
      save_book_metadata: () => ({ id: "book-a" }),
    });

    const ids = await importAbsolutePaths(
      ["/tmp/a.epub", "/tmp/a.epub", "/tmp/b.epub"],
      { askConfirm: async () => true, onNotice: vi.fn() },
    );

    expect(seen).toEqual([["/tmp/a.epub"], ["/tmp/b.epub"]]);
    expect(ids).toEqual(["book-a", "book-b"]);
  });

  it("surfaces a non-epub import error and continues the batch", async () => {
    const onNotice = vi.fn();
    setupInvoke({
      import_paths: (args) => {
        const paths = (args as { paths: string[] }).paths;
        if (paths[0] === "/tmp/notes.txt") {
          throw { code: "InvalidInput", message: "not an epub" };
        }
        return [{
          status: "duplicate",
          bookId: "book-2",
          title: "Kept",
          name: "kept.epub",
        }] satisfies ImportBookResult[];
      },
    });

    const ids = await importAbsolutePaths(
      ["/tmp/notes.txt", "/tmp/kept.epub"],
      { askConfirm: async () => true, onNotice },
    );

    expect(ids).toEqual(["book-2"]);
    expect(onNotice).toHaveBeenCalledWith({
      kind: "error",
      message: "导入失败：not an epub",
    });
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === "save_book_metadata")).toBe(false);
  });
});
