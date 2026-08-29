import { afterEach, describe, expect, it, vi } from "vitest";
import { BookWorkerClient, chapterAside, formatBookSnapshot, type BookTocEntry } from "./book-content";

const OriginalWorker = globalThis.Worker;
afterEach(() => { globalThis.Worker = OriginalWorker; });

const entry = (fields: Partial<BookTocEntry> & Pick<BookTocEntry, "index" | "label">): BookTocEntry => ({
  ancestors: [],
  depth: 0,
  hrefs: [],
  chars: 10,
  ...fields,
});

describe("BookWorkerClient lifecycle", () => {
  it("terminates the previous worker on superseding open", async () => {
    const terminate = vi.fn();
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: null = null;
      postMessage(message: { id: string }) {
        queueMicrotask(() => this.onmessage?.({ data: { id: message.id, result: null } } as MessageEvent));
      }
      terminate() { terminate(); }
    }
    globalThis.Worker = FakeWorker as never;
    const client = new BookWorkerClient();
    await client.open("a", new ArrayBuffer(1));
    await client.open("b", new ArrayBuffer(1));
    expect(terminate).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("rejects pending work when the active book is closed", async () => {
    class HangingWorker {
      onmessage = null;
      onerror = null;
      postMessage() {}
      terminate() {}
    }
    globalThis.Worker = HangingWorker as never;
    const client = new BookWorkerClient();
    const opening = client.open("a", new ArrayBuffer(1));
    client.close();
    await expect(opening).rejects.toThrow("电子书上下文已切换");
  });
});

describe("book prompt projection", () => {
  it("resolves reader hrefs internally and never exposes them in the chapter aside", () => {
    const toc = [entry({ index: 2, label: "Three", hrefs: ["OPS/text/three.xhtml"] })];
    const aside = chapterAside(toc, "text/three.xhtml#part");
    expect(aside).toBe("Current chapter: Three (chapterIndex 2)");
    expect(aside).not.toContain("xhtml");
  });

  it("prefers an exact file+fragment match over a file-only match (AC5)", () => {
    const toc = [
      entry({ index: 0, label: "第一章", hrefs: ["OPS/text/vol1.xhtml#ch1"] }),
      entry({ index: 1, label: "第二章", ancestors: ["第一卷 出走"], depth: 1, hrefs: ["OPS/text/vol1.xhtml#ch2"] }),
      entry({ index: 2, label: "第四章", hrefs: ["OPS/text/vol2.xhtml"] }),
    ];
    const aside = chapterAside(toc, "text/vol1.xhtml#ch2");
    expect(aside).toBe("Current chapter: 第一卷 出走 › 第二章 (chapterIndex 1)");
    // A bare section href falls back to file-only matching: first entry on that file.
    expect(chapterAside(toc, "text/vol1.xhtml")).toBe("Current chapter: 第一章 (chapterIndex 0)");
    expect(chapterAside(toc, "text/vol2.xhtml#unmatched")).toBe("Current chapter: 第四章 (chapterIndex 2)");
  });

  it("caps the persisted TOC snapshot and renders hierarchy indentation (AC6)", () => {
    const toc = [
      entry({ index: 0, label: "第一卷 出走" }),
      entry({ index: 1, label: "第一章 火车站", ancestors: ["第一卷 出走"], depth: 1 }),
    ];
    const snapshot = formatBookSnapshot({ title: "T", author: "A", language: "en", totalChapters: 2 }, toc);
    expect(snapshot).toContain("Table of Contents (2 of 2 entries)");
    expect(snapshot).toContain("1 [index 0]: 第一卷 出走");
    expect(snapshot).toContain("  2 [index 1]: 第一章 火车站");
    expect(snapshot).not.toContain("xhtml");
  });

  it("truncates deep TOCs and points to get_toc", () => {
    const toc = Array.from({ length: 250 }, (_, index) =>
      entry({ index, label: "", hrefs: [`${index}.xhtml`] }),
    );
    const snapshot = formatBookSnapshot({ title: "T", author: "A", language: "en", totalChapters: 250 }, toc);
    expect(snapshot).toContain("Table of Contents (200 of 250 entries)");
    expect(snapshot).toContain("[TOC truncated.");
    expect(snapshot).not.toContain("201 [index 200]");
  });
});
