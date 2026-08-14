import { afterEach, describe, expect, it, vi } from "vitest";
import { BookWorkerClient, chapterAside, formatBookSnapshot } from "./book-content";

const OriginalWorker = globalThis.Worker;
afterEach(() => { globalThis.Worker = OriginalWorker; });

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
    const toc = [{ index: 2, label: "Three", hrefs: ["OPS/text/three.xhtml"], chars: 10 }];
    const aside = chapterAside(toc, "text/three.xhtml#part");
    expect(aside).toBe("Current chapter: Three (chapterIndex 2)");
    expect(aside).not.toContain("xhtml");
  });

  it("caps the persisted TOC snapshot", () => {
    const toc = Array.from({ length: 250 }, (_, index) => ({ index, label: "", hrefs: [`${index}.xhtml`], chars: 10 }));
    const snapshot = formatBookSnapshot({ title: "T", author: "A", language: "en", totalChapters: 250 }, toc);
    expect(snapshot).toContain("Table of Contents (200 of 250 entries)");
    expect(snapshot).toContain("[TOC truncated.");
    expect(snapshot).not.toContain("201 [index 200]");
  });
});
