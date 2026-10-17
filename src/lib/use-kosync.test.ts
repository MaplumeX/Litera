// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderViewHandle } from "@/components/ReaderView";
import { KOSYNC_PUSH_DELAY_MS, useKosync } from "./use-kosync";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

const REMOTE = {
  progress: "/body/DocFragment[4]/body/p[2]",
  percentage: 0.42,
  device: "Kobo",
  deviceId: "kobo-1",
  timestamp: Date.parse("2026-10-17T12:00:00Z") / 1000,
};

let xpointer = "/body/DocFragment[2]/body/p";
const goToXPointer = vi.fn(async () => {});
const readerRef = {
  current: { getXPointer: () => xpointer, goToXPointer } as unknown as ReaderViewHandle,
};

function setup(pull: unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "kosync_pull") return Promise.resolve(pull);
    if (cmd === "kosync_push") return Promise.resolve();
    return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
  });
  return renderHook(() =>
    useKosync({ bookId: "book-1", readerRef, getLocalFraction: () => 0.17 }),
  );
}

const pushes = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "kosync_push");

beforeEach(() => {
  vi.useFakeTimers();
  xpointer = "/body/DocFragment[2]/body/p";
});

afterEach(() => {
  vi.useRealTimers();
  invokeMock.mockReset();
  goToXPointer.mockClear();
});

describe("useKosync", () => {
  it("asks before jumping to a newer remote position, and jumps on accept", async () => {
    const { result } = setup({ remote: REMOTE, localPositionUpdatedAt: "2026-10-17T10:00:00Z" });

    await act(() => result.current.onBookReady());
    expect(result.current.prompt).toEqual({ remote: REMOTE, localFraction: 0.17 });

    act(() => result.current.accept());
    expect(result.current.prompt).toBeNull();
    expect(goToXPointer).toHaveBeenCalledWith(REMOTE.progress, 0.42);
  });

  it("does not ask about an older remote position", async () => {
    const { result } = setup({ remote: REMOTE, localPositionUpdatedAt: "2026-10-17T13:00:00Z" });
    await act(() => result.current.onBookReady());
    expect(result.current.prompt).toBeNull();
  });

  it("pushes only after the pull settles, debounced, and not twice for one place", async () => {
    const { result } = setup(null);

    act(() => result.current.onRelocate(0.2));
    await act(() => vi.advanceTimersByTimeAsync(KOSYNC_PUSH_DELAY_MS));
    expect(pushes()).toHaveLength(0);

    await act(() => result.current.onBookReady());
    act(() => result.current.onRelocate(0.2));
    await act(() => vi.advanceTimersByTimeAsync(KOSYNC_PUSH_DELAY_MS - 1));
    expect(pushes()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(pushes()).toEqual([
      ["kosync_push", { bookId: "book-1", progress: xpointer, percentage: 0.2 }],
    ]);

    act(() => result.current.onRelocate(0.2));
    await act(() => vi.advanceTimersByTimeAsync(KOSYNC_PUSH_DELAY_MS));
    expect(pushes()).toHaveLength(1);
  });

  it("holds pushes while the prompt is open and flushes on demand", async () => {
    const { result } = setup({ remote: REMOTE, localPositionUpdatedAt: null });
    await act(() => result.current.onBookReady());

    act(() => result.current.onRelocate(0.18));
    await act(() => result.current.flush());
    expect(pushes()).toHaveLength(0);

    act(() => result.current.dismiss());
    xpointer = "/body/DocFragment[2]/body/p[3]";
    act(() => result.current.onRelocate(0.19));
    await act(() => result.current.flush());
    expect(pushes()).toHaveLength(1);
  });
});
