// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOK_SEARCH_DEBOUNCE_MS, useBookSearch } from "./use-book-search";

/** An async iterator replaying foliate-style search events. */
function events(list: unknown[], onReturn?: () => void): AsyncIterator<unknown> {
  let index = 0;
  return {
    next: async () =>
      index < list.length ? { done: false, value: list[index++] } : { done: true, value: undefined },
    return: async () => {
      onReturn?.();
      index = list.length;
      return { done: true, value: undefined };
    },
  };
}

const hitsIn = (label: string, ...cfis: string[]) => ({
  label,
  subitems: cfis.map((cfi) => ({ cfi, excerpt: { pre: "", match: "q", post: "" } })),
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(search = vi.fn((_query: string) => events([hitsIn("One", "a", "b"), hitsIn("Two", "c"), "done"]))) {
  const clear = vi.fn();
  const goTo = vi.fn();
  const hook = renderHook(
    ({ resetKey }) => useBookSearch({ search, clear, goTo, resetKey }),
    { initialProps: { resetKey: "book-1" as string | null } },
  );
  return { hook, search, clear, goTo };
}

async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync();
  });
}

describe("useBookSearch", () => {
  it("searches once typing pauses and collects grouped hits", async () => {
    const { hook, search } = setup();
    act(() => hook.result.current.setQuery("q"));
    act(() => hook.result.current.setQuery("qu"));
    expect(search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOOK_SEARCH_DEBOUNCE_MS);
    });
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("qu");
    expect(hook.result.current.status).toBe("done");
    expect(hook.result.current.results.total).toBe(3);
    expect(hook.result.current.results.groups.map((group) => group.label)).toEqual(["One", "Two"]);
  });

  it("steps through hits with Enter once the query has run", async () => {
    const { hook, goTo, search } = setup();
    act(() => hook.result.current.setQuery("q"));
    act(() => hook.result.current.submit(1));
    await flush();
    expect(search).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.submit(1));
    expect(hook.result.current.activeCfi).toBe("a");
    act(() => hook.result.current.submit(1));
    expect(hook.result.current.activeCfi).toBe("b");
    act(() => hook.result.current.submit(-1));
    expect(hook.result.current.activeCfi).toBe("a");
    expect(goTo).toHaveBeenLastCalledWith(expect.objectContaining({ cfi: "a" }));
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("cancels a running scan when the query changes", async () => {
    const stopped = vi.fn();
    let resolveFirst: (() => void) | undefined;
    const slow: AsyncIterator<unknown> = {
      next: () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ done: false, value: hitsIn("Old", "old") });
        }),
      return: async () => {
        stopped();
        return { done: true, value: undefined };
      },
    };
    const search = vi
      .fn((_query: string) => events([hitsIn("New", "new"), "done"]))
      .mockImplementationOnce(() => slow);
    const { hook } = setup(search);
    act(() => hook.result.current.setQuery("old"));
    act(() => hook.result.current.submit(1));
    act(() => hook.result.current.setQuery("new"));
    act(() => hook.result.current.submit(1));
    await act(async () => {
      resolveFirst?.();
    });
    await flush();
    expect(stopped).toHaveBeenCalled();
    expect(hook.result.current.results.groups.map((group) => group.label)).toEqual(["New"]);
  });

  it("clears results and the Book's outlines on reset", async () => {
    const { hook, clear } = setup();
    act(() => hook.result.current.setQuery("q"));
    act(() => hook.result.current.submit(1));
    await flush();
    act(() => hook.result.current.reset());
    expect(hook.result.current.query).toBe("");
    expect(hook.result.current.results.total).toBe(0);
    expect(hook.result.current.status).toBe("idle");
    expect(clear).toHaveBeenCalled();
  });

  it("drops the old Book's results when another Book opens", async () => {
    const { hook } = setup();
    act(() => hook.result.current.setQuery("q"));
    act(() => hook.result.current.submit(1));
    await flush();
    hook.rerender({ resetKey: "book-2" });
    expect(hook.result.current.query).toBe("");
    expect(hook.result.current.results.total).toBe(0);
  });

  it("stays idle when no Book can be searched", async () => {
    const { hook } = setup(vi.fn(() => null));
    act(() => hook.result.current.setQuery("q"));
    act(() => hook.result.current.submit(1));
    await flush();
    expect(hook.result.current.status).toBe("idle");
  });
});
