// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNC_DEBOUNCE_MS,
  SYNC_FAILURE_THRESHOLD,
  SYNC_PERIODIC_MS,
  useSyncScheduler,
} from "./use-sync-scheduler";
import { notifySyncActivity } from "./sync-activity";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

function manifest() {
  return { schemaVersion: 1, books: {}, tombstones: [], preferences: null, provider: null };
}

function setupSync(options: { enabled?: boolean; fail?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const fail = options.fail ?? false;
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_sync_config") return Promise.resolve({ enabled });
    if (cmd === "sync_upload_book_files") return Promise.resolve(null);
    if (cmd === "sync_export_local_manifest") return Promise.resolve(manifest());
    if (cmd === "sync_download_manifest") {
      if (fail) return Promise.reject({ code: "StorageIo", message: "backend unreachable" });
      return Promise.resolve({ etag: "etag-1", manifest: manifest() });
    }
    return Promise.resolve(null);
  });
}

function syncRuns(): number {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "sync_export_local_manifest").length;
}

/** Let pending microtask chains (the invoke round trips) settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useSyncScheduler", () => {
  it("syncs automatically at startup when Sync is enabled", async () => {
    setupSync({ enabled: true });

    renderHook(() => useSyncScheduler());
    await flush();

    expect(syncRuns()).toBe(1);
  });

  it("records sync outcomes for the Settings status area", async () => {
    setupSync({ enabled: true, fail: false });
    renderHook(() => useSyncScheduler());
    await flush();

    const successCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "sync_note_result",
    );
    expect(successCall?.[1]).toEqual({ success: true, error: null });
  });

  it("never syncs when Sync is disabled", async () => {
    setupSync({ enabled: false });

    renderHook(() => useSyncScheduler());
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS * 2);
    });

    expect(syncRuns()).toBe(0);
  });

  it("pushes after local changes settle down (debounced)", async () => {
    setupSync({ enabled: true });
    const { result } = renderHook(() => useSyncScheduler());
    await flush();
    expect(syncRuns()).toBe(1);

    notifySyncActivity();
    notifySyncActivity();
    notifySyncActivity();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS / 2);
    });
    // Still settling: one burst of activity coalesces into one sync.
    expect(syncRuns()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS);
    });
    await flush();

    expect(syncRuns()).toBe(2);
    expect(result.current.persistentFailure).toBeNull();
  });

  it("re-syncs periodically during long sessions", async () => {
    setupSync({ enabled: true });
    renderHook(() => useSyncScheduler());
    await flush();
    expect(syncRuns()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS);
    });
    await flush();

    expect(syncRuns()).toBe(2);
  });

  it("surfaces a failure notice only after several consecutive failures", async () => {
    setupSync({ enabled: true, fail: true });
    const { result } = renderHook(() => useSyncScheduler());
    await flush();

    // Failures below the threshold stay silent (startup counts as one).
    while (syncRuns() < SYNC_FAILURE_THRESHOLD - 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS);
      });
      await flush();
      expect(result.current.persistentFailure).toBeNull();
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS);
    });
    await flush();

    expect(syncRuns()).toBe(SYNC_FAILURE_THRESHOLD);
    expect(result.current.persistentFailure).toContain("backend unreachable");
    const failureCall = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "sync_note_result" && (invokeMock.mock.calls.findLast?.(() => true), true),
    );
    void failureCall;
    const failureCalls = invokeMock.mock.calls.filter(
      ([cmd]) => cmd === "sync_note_result",
    );
    expect(failureCalls.length).toBeGreaterThanOrEqual(SYNC_FAILURE_THRESHOLD);

    // The notice is dismissable and never modal.
    act(() => {
      result.current.clearPersistentFailure();
    });
    expect(result.current.persistentFailure).toBeNull();
  });

  it("clears the failure state once a sync succeeds again", async () => {
    let failing = true;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_sync_config") return Promise.resolve({ enabled: true });
      if (cmd === "sync_upload_book_files") return Promise.resolve(null);
      if (cmd === "sync_export_local_manifest") return Promise.resolve(manifest());
      if (cmd === "sync_download_manifest") {
        if (failing) {
          return Promise.reject({ code: "StorageIo", message: "backend unreachable" });
        }
        return Promise.resolve({ etag: "etag-1", manifest: manifest() });
      }
      return Promise.resolve(null);
    });
    const { result } = renderHook(() => useSyncScheduler());
    await flush();
    while (syncRuns() < SYNC_FAILURE_THRESHOLD) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS);
      });
      await flush();
    }
    expect(result.current.persistentFailure).toBeTruthy();

    // The backend recovers.
    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SYNC_PERIODIC_MS);
    });
    await flush();

    expect(syncRuns()).toBe(SYNC_FAILURE_THRESHOLD + 1);
    expect(result.current.persistentFailure).toBeNull();
  });
});
