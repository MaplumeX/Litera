import { describe, expect, it, vi } from "vitest";
import { registerOpenPathsListener } from "./open-paths";

describe("registerOpenPathsListener", () => {
  it("takes the cold-start queue after listen resolves and opens the last success", async () => {
    const takePending = vi
      .fn()
      .mockResolvedValueOnce(["/tmp/a.epub", "/tmp/b.epub"])
      .mockResolvedValue([]);
    const importPaths = vi.fn(async () => ["book-a", "book-b"]);
    const openBook = vi.fn();
    const onError = vi.fn();

    const subscription = registerOpenPathsListener({
      listen: async () => () => undefined,
      takePending,
      importPaths,
      openBook,
      onError,
    });
    await subscription.ready;
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-b");
    });
    expect(takePending).toHaveBeenCalledTimes(2);
    expect(importPaths).toHaveBeenCalledWith(["/tmp/a.epub", "/tmp/b.epub"]);
    expect(onError).not.toHaveBeenCalled();
    subscription.dispose();
  });

  it("does not open a book when take returns an empty queue", async () => {
    const openBook = vi.fn();
    const subscription = registerOpenPathsListener({
      listen: async () => () => undefined,
      takePending: async () => [],
      importPaths: vi.fn(async () => ["should-not-run"]),
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await Promise.resolve();
    expect(openBook).not.toHaveBeenCalled();
    subscription.dispose();
  });

  it("does not open a cancelled overwrite and still opens a later success", async () => {
    const takePending = vi
      .fn()
      .mockResolvedValueOnce(["/tmp/old.epub", "/tmp/new.epub"])
      .mockResolvedValue([]);
    const openBook = vi.fn();
    const subscription = registerOpenPathsListener({
      listen: async () => () => undefined,
      takePending,
      importPaths: async () => ["book-new"],
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-new");
    });
    expect(openBook).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  it("immediately unlistens when listen resolves after dispose", async () => {
    let resolveListen: ((cleanup: () => void) => void) | undefined;
    const cleanup = vi.fn();
    const takePending = vi.fn();
    const subscription = registerOpenPathsListener({
      listen: () => new Promise((resolve) => {
        resolveListen = resolve;
      }),
      takePending,
      importPaths: vi.fn(async () => []),
      openBook: vi.fn(),
      onError: vi.fn(),
    });
    subscription.dispose();
    resolveListen?.(cleanup);
    await subscription.ready;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(takePending).not.toHaveBeenCalled();
  });

  it("ignores a repeated path from a later take in the same burst", async () => {
    const takePending = vi
      .fn()
      .mockResolvedValueOnce(["/tmp/a.epub"])
      .mockResolvedValueOnce(["/tmp/a.epub"])
      .mockResolvedValue([]);
    const importPaths = vi.fn(async () => ["book-a"]);
    const openBook = vi.fn();

    const subscription = registerOpenPathsListener({
      listen: async () => () => undefined,
      takePending,
      importPaths,
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-a");
    });
    expect(importPaths).toHaveBeenCalledTimes(1);
    expect(importPaths).toHaveBeenCalledWith(["/tmp/a.epub"]);
    subscription.dispose();
  });

  it("allows a later retry when the first burst imported nothing", async () => {
    const takePending = vi
      .fn()
      .mockResolvedValueOnce(["/tmp/same.epub"])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["/tmp/same.epub"])
      .mockResolvedValue([]);
    const importPaths = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["book-same"]);
    const openBook = vi.fn();
    let handler: (() => void) | undefined;

    const subscription = registerOpenPathsListener({
      listen: async (listenHandler) => {
        handler = listenHandler;
        return () => {
          handler = undefined;
        };
      },
      takePending,
      importPaths,
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await vi.waitFor(() => {
      expect(importPaths).toHaveBeenCalledTimes(1);
    });
    expect(openBook).not.toHaveBeenCalled();

    handler?.();
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-same");
    });
    expect(importPaths).toHaveBeenCalledTimes(2);
    subscription.dispose();
  });

  it("imports a new path that arrives while coalescing the first take", async () => {
    const takePending = vi
      .fn()
      .mockResolvedValueOnce(["/tmp/a.epub"])
      .mockResolvedValueOnce(["/tmp/b.epub"])
      .mockResolvedValue([]);
    const importPaths = vi.fn(async (paths: string[]) =>
      paths.map((path) => (path.endsWith("a.epub") ? "book-a" : "book-b")),
    );
    const openBook = vi.fn();

    const subscription = registerOpenPathsListener({
      listen: async () => () => undefined,
      takePending,
      importPaths,
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-b");
    });
    expect(importPaths).toHaveBeenCalledTimes(2);
    expect(openBook).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });

  it("drains again when the event fires after the initial take", async () => {
    let handler: (() => void) | undefined;
    const takePending = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["/tmp/hot.epub"])
      .mockResolvedValue([]);
    const openBook = vi.fn();
    const subscription = registerOpenPathsListener({
      listen: async (listenHandler) => {
        handler = listenHandler;
        return () => {
          handler = undefined;
        };
      },
      takePending,
      importPaths: async () => ["book-hot"],
      openBook,
      onError: vi.fn(),
    });
    await subscription.ready;
    await Promise.resolve();
    expect(openBook).not.toHaveBeenCalled();
    handler?.();
    await vi.waitFor(() => {
      expect(openBook).toHaveBeenCalledWith("book-hot");
    });
    subscription.dispose();
  });
});
