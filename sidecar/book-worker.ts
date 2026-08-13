import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import {
  closeBook,
  getBookMetadata,
  getToc,
  loadBook,
  readChapter,
  runFtsSmoke,
  searchInBook,
  type BookMetadata,
  type SearchResult,
  type TocEntry,
} from "./book.js";

type BookWorkerRequest =
  | { id: number; type: "fts_smoke" }
  | { id: number; type: "load"; bookId: string; generation: number; path: string }
  | { id: number; type: "metadata"; bookId: string; generation: number }
  | { id: number; type: "toc"; bookId: string; generation: number }
  | { id: number; type: "read_chapter"; bookId: string; generation: number; index: number }
  | { id: number; type: "search"; bookId: string; generation: number; queries: string[] }
  | { id: number; type: "close" };

type BookWorkerResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

type BookWorkerCommand = BookWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function isBookWorkerThread(): boolean {
  return !isMainThread && workerData?.literaBookWorker === true;
}

export function runBookWorker(): void {
  if (!parentPort) throw new Error("Book worker started without a parent port");
  let tail = Promise.resolve();
  parentPort.on("message", (request: BookWorkerRequest) => {
    tail = tail.then(() => handleWorkerRequest(request)).then(
      (value) => parentPort?.postMessage({ id: request.id, ok: true, value } satisfies BookWorkerResponse),
      (error: unknown) => parentPort?.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies BookWorkerResponse),
    );
  });
}

let loadedBook: { bookId: string; generation: number } | null = null;

function requireLoadedBook(bookId: string, generation: number): void {
  if (!loadedBook || loadedBook.bookId !== bookId || loadedBook.generation !== generation) {
    throw new Error("Book worker request does not match the loaded book generation");
  }
}

async function handleWorkerRequest(request: BookWorkerRequest): Promise<unknown> {
  switch (request.type) {
    case "fts_smoke":
      await runFtsSmoke();
      return true;
    case "load":
      {
        const metadata = await loadBook(request.path);
        loadedBook = { bookId: request.bookId, generation: request.generation };
        return { generation: request.generation, metadata };
      }
    case "metadata":
      requireLoadedBook(request.bookId, request.generation);
      return getBookMetadata();
    case "toc":
      requireLoadedBook(request.bookId, request.generation);
      return getToc();
    case "read_chapter":
      requireLoadedBook(request.bookId, request.generation);
      return readChapter(request.index);
    case "search":
      requireLoadedBook(request.bookId, request.generation);
      return searchInBook(request.queries);
    case "close":
      closeBook();
      loadedBook = null;
      return true;
  }
}

export class BookWorker {
  private static readonly MAX_PENDING = 128;
  private readonly worker = new Worker(__filename, { workerData: { literaBookWorker: true } });
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stopped = false;

  constructor() {
    this.worker.on("message", (response: BookWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.error));
    });
    this.worker.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
    this.worker.on("exit", (code) => {
      if (!this.stopped) this.failAll(new Error(`Book worker exited with code ${code}`));
    });
  }

  async runFtsSmoke(): Promise<void> {
    await this.request({ type: "fts_smoke" });
  }

  load(path: string, bookId: string, generation: number): Promise<{ generation: number; metadata: BookMetadata }> {
    return this.request({ type: "load", path, bookId, generation });
  }

  metadata(bookId: string, generation: number): Promise<BookMetadata> {
    return this.request({ type: "metadata", bookId, generation });
  }

  toc(bookId: string, generation: number): Promise<TocEntry[]> {
    return this.request({ type: "toc", bookId, generation });
  }

  readChapter(bookId: string, generation: number, index: number): Promise<string> {
    return this.request({ type: "read_chapter", bookId, generation, index });
  }

  search(bookId: string, generation: number, queries: string[]): Promise<SearchResult[]> {
    return this.request({ type: "search", bookId, generation, queries });
  }

  async closeBook(): Promise<void> {
    await this.request({ type: "close" });
  }

  async terminate(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.failAll(new Error("Book worker stopped"));
    await this.worker.terminate();
  }

  private request<T>(request: BookWorkerCommand): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("Book worker is stopped"));
    if (this.pending.size >= BookWorker.MAX_PENDING) {
      return Promise.reject(new Error("Book worker request queue is full"));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
