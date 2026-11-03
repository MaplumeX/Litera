// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { saveReadingStatsEnabled } from "@/lib/reading-stats-prefs";
import { useReadingTracker } from "@/lib/use-reading-tracker";
import type { AgentEvent } from "@/types/agent";

const runtime = vi.hoisted(() => ({ listener: null as ((event: AgentEvent) => void) | null }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@/agent/runtime/embedded-runtime", () => ({
  embeddedAgentRuntime: {
    subscribe: (listener: (event: AgentEvent) => void) => {
      runtime.listener = listener;
      return () => {
        runtime.listener = null;
      };
    },
  },
}));

const MINUTE = 60_000;

function recorded() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "record_sitting")
    .map(([, args]) => (args as { sitting: { id: string; seconds: number } }).sitting);
}

function setHidden(hidden: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(hidden ? "hidden" : "visible");
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useReadingTracker", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 3, 12));
    vi.mocked(invoke).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("saves through record_sitting at each checkpoint", async () => {
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0.1, "reader");
    await act(() => vi.advanceTimersByTimeAsync(MINUTE));
    expect(recorded().at(-1)).toMatchObject({ bookId: "book", seconds: 60, mode: "reader" });
  });

  it("counts input anywhere around the Book", async () => {
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "reader");
    await act(() => vi.advanceTimersByTimeAsync(2 * MINUTE));
    window.dispatchEvent(new Event("pointerdown"));
    await act(() => vi.advanceTimersByTimeAsync(2 * MINUTE));
    window.dispatchEvent(new Event("keydown"));
    await result.current.flush();
    expect(recorded().map((s) => s.id).every((id) => id === recorded()[0].id)).toBe(true);
    expect(recorded().at(-1)?.seconds).toBe(240);
  });

  it("keeps counting while TTS plays with no input, and not after", async () => {
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "reader");
    result.current.setTtsPlaying(true);
    await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE));
    expect(recorded().at(-1)?.seconds).toBe(600);
    result.current.setTtsPlaying(false);
    await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE));
    expect(recorded().at(-1)?.seconds).toBe(600 + 180);
  });

  it("keeps counting while an answer streams", async () => {
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "agent");
    runtime.listener?.({ type: "prompt_started" } as AgentEvent);
    await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE));
    expect(recorded().at(-1)?.seconds).toBe(600);
    runtime.listener?.({ type: "prompt_end" } as AgentEvent);
    await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE));
    expect(recorded().at(-1)?.seconds).toBe(600 + 180);
  });

  it("stops counting when the window is hidden, and saves right away", async () => {
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "reader");
    await act(() => vi.advanceTimersByTimeAsync(45_000));
    setHidden(true);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(recorded().at(-1)?.seconds).toBe(45);
    await act(() => vi.advanceTimersByTimeAsync(10 * MINUTE));
    expect(recorded().at(-1)?.seconds).toBe(45);
  });

  it("records nothing with the setting off", async () => {
    saveReadingStatsEnabled(false);
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "reader");
    await act(() => vi.advanceTimersByTimeAsync(5 * MINUTE));
    result.current.end();
    await result.current.flush();
    expect(recorded()).toEqual([]);
  });

  it("survives a failed write and keeps later ones in order", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderHook(() => useReadingTracker());
    result.current.begin("book", 0, "reader");
    await act(() => vi.advanceTimersByTimeAsync(MINUTE));
    await act(() => vi.advanceTimersByTimeAsync(MINUTE));
    await expect(result.current.flush()).resolves.toBeUndefined();
    expect(recorded().map((s) => s.seconds)).toEqual([60, 120]);
  });
});
