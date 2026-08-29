export const CHAPTER_PART_CHARS = 12_000;
export interface BookMetadata { title: string; author: string; language: string; totalChapters: number }
export interface BookTocEntry { index: number; label: string; ancestors: string[]; depth: number; hrefs: string[]; chars: number }
export interface SearchHit { chapterIndex: number; chapterTitle?: string; part: number; match: "exact" | "partial"; snippet: string }
export const BOOK_SNAPSHOT_MAX_TOC_ENTRIES = 200;
export const BOOK_SNAPSHOT_MAX_TOC_CHARS = 4_000;
export interface BookContentPort {
  open(bookId: string, bytes: ArrayBuffer): Promise<void>;
  metadata(): Promise<BookMetadata>;
  toc(): Promise<BookTocEntry[]>;
  readChapter(chapterIndex: number, part?: number): Promise<{ chapterIndex: number; chapterNumber: number; part: number; totalParts: number; text: string }>;
  search(queries: string[]): Promise<SearchHit[]>;
  close(): void;
}

function canonicalHref(href: string): string {
  let value = href.split("#")[0] ?? "";
  try { value = decodeURI(value); } catch { /* Compare malformed legacy hrefs raw. */ }
  return value.replace(/\\/g, "/").replace(/^(?:\.\.\/)+/, "").replace(/^\/+/, "");
}

export function hrefMatches(leftHref: string, rightHref: string): boolean {
  const left = canonicalHref(leftHref);
  const right = canonicalHref(rightHref);
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function chapterTitle(entry: BookTocEntry): string {
  return [...entry.ancestors, entry.label].filter(Boolean).join(" › ");
}

function sameFragmentHref(left: string, right: string): boolean {
  return hrefMatches(left, right) && (left.split("#")[1] ?? "") === (right.split("#")[1] ?? "");
}

export function chapterAside(toc: readonly BookTocEntry[], href: string | undefined): string | undefined {
  if (!href) return undefined;
  const exact = toc.find((entry) => entry.hrefs.some((candidate) => sameFragmentHref(candidate, href)));
  const chapter = exact ?? toc.find((entry) => entry.hrefs.some((candidate) => hrefMatches(candidate, href)));
  if (!chapter) return undefined;
  const title = chapterTitle(chapter).trim();
  return title
    ? `Current chapter: ${title} (chapterIndex ${chapter.index})`
    : `Current chapterIndex: ${chapter.index}`;
}

export function formatBookSnapshot(metadata: BookMetadata, toc: readonly BookTocEntry[]): string {
  const lines: string[] = [];
  let chars = 0;
  for (const entry of toc) {
    if (lines.length >= BOOK_SNAPSHOT_MAX_TOC_ENTRIES) break;
    const line = `${"  ".repeat(entry.depth)}${entry.index + 1} [index ${entry.index}]: ${entry.label}`;
    const next = chars === 0 ? line.length : chars + 1 + line.length;
    if (next > BOOK_SNAPSHOT_MAX_TOC_CHARS) break;
    lines.push(line);
    chars = next;
  }
  const parts = [
    "Book snapshot (already provided; do not call get_book_metadata or get_toc unless the TOC is truncated):",
    `Title: ${metadata.title}`,
    `Author: ${metadata.author}`,
    `Language: ${metadata.language}`,
    `Total chapters: ${metadata.totalChapters}`,
    "",
    `Table of Contents (${lines.length} of ${toc.length} entries):`,
  ];
  if (lines.length) parts.push(lines.join("\n"));
  if (lines.length < toc.length) parts.push("[TOC truncated. Call get_toc for the full list.]");
  return parts.join("\n");
}

type Request = { id: string; method: "open" | "metadata" | "toc" | "readChapter" | "search"; args: unknown[] };
type Response = { id: string; result?: unknown; error?: string };

export class BookWorkerClient implements BookContentPort {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private generation = 0;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const generation = ++this.generation;
    const worker = new Worker(new URL("./epub.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<Response>) => {
      if (generation !== this.generation) return;
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.result);
    };
    worker.onerror = () => {
      if (generation !== this.generation) return;
      this.generation += 1;
      worker.terminate();
      this.worker = null;
      this.failAll("电子书内容工作线程失败");
    };
    this.worker = worker;
    return worker;
  }

  private call<T>(method: Request["method"], args: unknown[], transfer: Transferable[] = []): Promise<T> {
    const id = crypto.randomUUID();
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        worker.postMessage({ id, method, args } satisfies Request, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async open(bookId: string, bytes: ArrayBuffer): Promise<void> {
    this.close();
    const copy = bytes.slice(0);
    await this.call("open", [bookId, copy], [copy]);
  }
  metadata(): Promise<BookMetadata> { return this.call("metadata", []); }
  toc(): Promise<BookTocEntry[]> { return this.call("toc", []); }
  readChapter(chapterIndex: number, part = 0) { return this.call<Awaited<ReturnType<BookContentPort["readChapter"]>>>("readChapter", [chapterIndex, part]); }
  search(queries: string[]): Promise<SearchHit[]> { return this.call("search", [queries]); }
  close(): void { this.generation += 1; this.worker?.terminate(); this.worker = null; this.failAll("电子书上下文已切换"); }
  private failAll(message: string) { for (const pending of this.pending.values()) pending.reject(new Error(message)); this.pending.clear(); }
}
