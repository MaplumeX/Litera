// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_IDLE_MS, useIdleChrome } from "@/lib/use-idle-chrome";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useIdleChrome", () => {
  it("goes idle after the delay and wakes on demand", () => {
    const { result } = renderHook(() => useIdleChrome(true));
    expect(result.current.idle).toBe(false);
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS));
    expect(result.current.idle).toBe(true);
    act(() => result.current.wake());
    expect(result.current.idle).toBe(false);
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS - 1));
    expect(result.current.idle).toBe(false);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.idle).toBe(true);
  });

  it("never goes idle while disabled, and shows the bars on disabling", () => {
    const { result, rerender } = renderHook(({ on }) => useIdleChrome(on), {
      initialProps: { on: false },
    });
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS * 3));
    expect(result.current.idle).toBe(false);
    rerender({ on: true });
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS));
    expect(result.current.idle).toBe(true);
    rerender({ on: false });
    expect(result.current.idle).toBe(false);
  });

  it("stays up while a bar has focus", () => {
    const bar = document.createElement("div");
    bar.dataset.readerChrome = "";
    const button = document.createElement("button");
    bar.append(button);
    document.body.append(bar);
    button.focus();
    const { result } = renderHook(() => useIdleChrome(true));
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS * 2));
    expect(result.current.idle).toBe(false);
    button.blur();
    act(() => void vi.advanceTimersByTime(CHROME_IDLE_MS));
    expect(result.current.idle).toBe(true);
  });
});
