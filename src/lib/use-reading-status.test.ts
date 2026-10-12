// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStatus } from "@/types/library";
import { useReadingStatus } from "./use-reading-status";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

function setup(status: ReadingStatus) {
  const onError = vi.fn();
  const hook = renderHook(() => useReadingStatus({ onError }));
  act(() => hook.result.current.begin("book-1", status));
  const relocate = (fraction: number) =>
    act(() => hook.result.current.onRelocate(fraction));
  return { hook, relocate, onError };
}

function calls(cmd: string) {
  return invokeMock.mock.calls.filter(([name]) => name === cmd);
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({});
});

afterEach(cleanup);

describe("useReadingStatus", () => {
  it("does not count the relocate that restores the position as reading", () => {
    const { relocate } = setup("unread");
    relocate(0.3);
    relocate(0.3);
    expect(calls("mark_book_started")).toHaveLength(0);
  });

  it.each(["unread", "paused"] as const)(
    "starts a %s book on the first page turn, once",
    (status) => {
      const { relocate } = setup(status);
      relocate(0.3);
      relocate(0.31);
      relocate(0.32);
      expect(calls("mark_book_started")).toEqual([
        ["mark_book_started", { bookId: "book-1" }],
      ]);
    },
  );

  it.each(["reading", "finished"] as const)("leaves a %s book alone", (status) => {
    const { relocate } = setup(status);
    relocate(0.3);
    relocate(0.31);
    expect(calls("mark_book_started")).toHaveLength(0);
  });

  it("offers Mark as finished once on reaching the end", () => {
    const { hook, relocate } = setup("reading");
    relocate(0.9);
    expect(hook.result.current.finishPromptOpen).toBe(false);
    relocate(0.99);
    expect(hook.result.current.finishPromptOpen).toBe(true);

    act(() => hook.result.current.dismissFinishPrompt());
    relocate(0.995);
    expect(hook.result.current.finishPromptOpen).toBe(false);
  });

  it("does not offer it when the book opens at the end", () => {
    const { hook, relocate } = setup("reading");
    relocate(0.99);
    expect(hook.result.current.finishPromptOpen).toBe(false);
  });

  it("does not offer it for a finished book", () => {
    const { hook, relocate } = setup("finished");
    relocate(0.5);
    relocate(1);
    expect(hook.result.current.finishPromptOpen).toBe(false);
  });

  it("marks the book finished from the prompt", async () => {
    const { hook, relocate } = setup("reading");
    relocate(0.5);
    relocate(0.99);
    await act(() => hook.result.current.markFinished());
    expect(hook.result.current.finishPromptOpen).toBe(false);
    expect(calls("update_book_curation")).toEqual([
      ["update_book_curation", { bookId: "book-1", readingStatus: "finished", starred: null }],
    ]);
  });

  it("starts over on the next open of the same book", () => {
    const { hook, relocate } = setup("unread");
    relocate(0.1);
    relocate(0.2);
    act(() => hook.result.current.end());
    act(() => hook.result.current.begin("book-1", "paused"));
    relocate(0.2);
    relocate(0.25);
    expect(calls("mark_book_started")).toHaveLength(2);
  });

  it("reports a failed start", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    const { relocate, onError } = setup("unread");
    relocate(0);
    relocate(0.01);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });
});
