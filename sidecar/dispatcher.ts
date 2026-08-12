export class SerialDispatcher {
  private tail: Promise<void> = Promise.resolve();
  private readonly reportError: (error: unknown) => void;
  private readonly capacity: number;
  private queued = 0;

  constructor(reportError: (error: unknown) => void, capacity = 128) {
    this.reportError = reportError;
    this.capacity = capacity;
  }

  enqueue(task: () => Promise<void>): boolean {
    if (this.queued >= this.capacity) return false;
    this.queued += 1;
    this.tail = this.tail
      .then(task)
      .catch((error) => this.reportError(error))
      .finally(() => { this.queued -= 1; });
    return true;
  }

  bypass(task: () => Promise<void>): void {
    void task().catch((error) => this.reportError(error));
  }

  async idle(): Promise<void> {
    await this.tail;
  }
}

export class BookLoadGate {
  private generation = 0;
  private bookId: string | null = null;

  begin(bookId: string): number {
    this.generation += 1;
    this.bookId = bookId;
    return this.generation;
  }

  clear(): number {
    this.generation += 1;
    this.bookId = null;
    return this.generation;
  }

  accepts(generation: number, bookId: string): boolean {
    return generation === this.generation && bookId === this.bookId;
  }

  current(): { generation: number; bookId: string | null } {
    return { generation: this.generation, bookId: this.bookId };
  }
}

export class BoundedCancellationSet {
  private readonly ids = new Set<string>();
  private readonly capacity: number;

  constructor(capacity = 256) {
    this.capacity = capacity;
  }

  add(id: string): void {
    if (this.ids.size >= this.capacity) {
      const oldest = this.ids.values().next().value;
      if (oldest) this.ids.delete(oldest);
    }
    this.ids.add(id);
  }

  consume(id: string): boolean {
    return this.ids.delete(id);
  }
}

export interface BackpressureSink {
  write(chunk: string): boolean;
  once(event: "drain", listener: () => void): unknown;
}

export class BoundedOutputQueue {
  private readonly sink: BackpressureSink;
  private readonly onOverflow: () => void;
  private readonly maximumFrames: number;
  private readonly maximumBytes: number;
  private readonly queue: Array<{ frame: string; bytes: number }> = [];
  private queuedBytes = 0;
  private blocked = false;
  private stopped = false;

  constructor(
    sink: BackpressureSink,
    onOverflow: () => void,
    maximumFrames = 256,
    maximumBytes = 4 * 1024 * 1024,
  ) {
    this.sink = sink;
    this.onOverflow = onOverflow;
    this.maximumFrames = maximumFrames;
    this.maximumBytes = maximumBytes;
  }

  write(frame: string): boolean {
    if (this.stopped) return false;
    if (!this.blocked && this.queue.length === 0) {
      this.blocked = !this.sink.write(frame);
      if (this.blocked) this.armDrain();
      return true;
    }

    const bytes = Buffer.byteLength(frame, "utf8");
    if (this.queue.length >= this.maximumFrames || this.queuedBytes + bytes > this.maximumBytes) {
      this.stopped = true;
      this.queue.length = 0;
      this.queuedBytes = 0;
      this.onOverflow();
      return false;
    }
    this.queue.push({ frame, bytes });
    this.queuedBytes += bytes;
    return true;
  }

  private armDrain(): void {
    this.sink.once("drain", () => this.flush());
  }

  private flush(): void {
    if (this.stopped) return;
    this.blocked = false;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) return;
      this.queuedBytes -= next.bytes;
      if (!this.sink.write(next.frame)) {
        this.blocked = true;
        this.armDrain();
        return;
      }
    }
  }
}

export interface AsyncTerminable {
  terminate(): Promise<unknown>;
}

export class SupersedingResource<T extends AsyncTerminable> {
  private value: T | null = null;
  private readonly factory: () => T;
  private readonly reportError: (error: unknown) => void;
  private readonly retirements = new Set<Promise<void>>();

  constructor(factory: () => T, reportError: (error: unknown) => void) {
    this.factory = factory;
    this.reportError = reportError;
  }

  replace(): T {
    const previous = this.value;
    const replacement = this.factory();
    this.value = replacement;
    this.retire(previous);
    return replacement;
  }

  clear(): void {
    const previous = this.value;
    this.value = null;
    this.retire(previous);
  }

  current(): T | null {
    return this.value;
  }

  async shutdown(): Promise<void> {
    this.clear();
    await Promise.allSettled([...this.retirements]);
  }

  private retire(resource: T | null): void {
    if (!resource) return;
    const retirement = Promise.resolve()
      .then(() => resource.terminate())
      .then(() => undefined, (error: unknown) => { this.reportError(error); })
      .finally(() => { this.retirements.delete(retirement); });
    this.retirements.add(retirement);
  }
}
