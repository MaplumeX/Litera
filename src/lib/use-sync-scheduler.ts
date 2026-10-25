import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { invokeErrorMessage } from "@/lib/app-error";
import { runSyncOnce } from "@/lib/sync-runner";
import { subscribeSyncActivity } from "@/lib/sync-activity";

/** Local changes settle down before pushing (page turns don't spam). */
export const SYNC_DEBOUNCE_MS = 30_000;
/** Discrete user actions (Annotations, deletions, edits) push sooner. */
export const SYNC_PROMPT_DEBOUNCE_MS = 5_000;
/** Steady activity (reading on) still pushes this soon after its first change. */
export const SYNC_MAX_WAIT_MS = 60_000;
/** Returning to the app pulls, unless a pass started this recently. */
export const SYNC_RETURN_MIN_INTERVAL_MS = 15_000;
/** Long reading sessions stay converged without intervention. */
export const SYNC_PERIODIC_MS = 5 * 60_000;
/** Silent retries; a non-blocking notice appears only past this many
 * consecutive failures. */
export const SYNC_FAILURE_THRESHOLD = 3;

interface SyncConfigLike {
  enabled: boolean;
}

export interface SyncScheduler {
  /** Set when several consecutive syncs failed; dismissable, never modal. */
  persistentFailure: string | null;
  clearPersistentFailure: () => void;
  /** Run a pass now. */
  syncNow: () => Promise<void>;
  /**
   * Pull what other devices did, now that the user is back (window focus,
   * Android foreground); skipped when a pass is running or just started.
   */
  syncOnReturn: () => void;
}

export interface SyncSchedulerOptions {
  /**
   * Whether this pass may upload book files. Asked before every pass; the
   * mobile shell says no on a metered network with "Wi-Fi only" on. The
   * Manifest and Sessions sync either way.
   */
  transferBookFiles?: () => Promise<boolean>;
}

/**
 * Automatic Sync cadence: run at app startup when Sync is enabled, push a
 * debounced sync after local changes settle (sooner for discrete actions, and
 * never later than a bound under steady activity), pull when the user returns
 * to the window, and re-sync periodically. All runs are silent; only repeated
 * consecutive failures surface to the UI.
 */
export function useSyncScheduler(options: SyncSchedulerOptions = {}): SyncScheduler {
  const transferBookFilesRef = useRef(options.transferBookFiles);
  transferBookFilesRef.current = options.transferBookFiles;
  const [persistentFailure, setPersistentFailure] = useState<string | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const runningRef = useRef(false);
  // A request that arrived mid-pass: run once more afterwards, so changes made
  // during a pass do not wait for the periodic timer.
  const rerunRef = useRef(false);
  const lastStartedAtRef = useRef<number | null>(null);

  const runPass = useCallback(async () => {
    try {
      const config = await invoke<SyncConfigLike | null>("get_sync_config");
      if (!config?.enabled) return;
      // Unsure whether the network is metered: keep the book files for later.
      const uploadFiles = await (transferBookFilesRef.current?.() ?? Promise.resolve(true)).catch(
        () => false,
      );
      await runSyncOnce({ uploadFiles });
      await invoke("sync_note_result", { success: true, error: null });
      consecutiveFailuresRef.current = 0;
      setPersistentFailure(null);
    } catch (error) {
      const message = invokeErrorMessage(error);
      // The Settings status area stays accurate even for automatic runs;
      // recording the failure must not mask the failure itself.
      await invoke("sync_note_result", { success: false, error: message }).catch(() => {});
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= SYNC_FAILURE_THRESHOLD) {
        setPersistentFailure(message);
      }
    }
  }, []);

  const sync = useCallback(async () => {
    if (runningRef.current) {
      rerunRef.current = true;
      return;
    }
    runningRef.current = true;
    lastStartedAtRef.current = Date.now();
    try {
      do {
        rerunRef.current = false;
        await runPass();
      } while (rerunRef.current);
    } finally {
      runningRef.current = false;
    }
  }, [runPass]);

  const syncOnReturn = useCallback(() => {
    if (runningRef.current) return;
    const lastStartedAt = lastStartedAtRef.current;
    if (lastStartedAt !== null && Date.now() - lastStartedAt < SYNC_RETURN_MIN_INTERVAL_MS) {
      return;
    }
    void sync();
  }, [sync]);

  useEffect(() => {
    let disposed = false;

    // Startup: a fresh session starts converged.
    void invoke<SyncConfigLike | null>("get_sync_config")
      .then((config) => {
        if (!disposed && config?.enabled) void sync();
      })
      .catch(() => {
        // Sync being unconfigured must never interrupt startup.
      });

    // Local changes: debounced push after things settle down. A discrete
    // action keeps its short deadline even if steady activity follows, and
    // steady activity cannot postpone the push past the max wait.
    let debounceTimer: number | null = null;
    let firstChangeAt: number | null = null;
    let promptDueAt: number | null = null;
    const unsubscribe = subscribeSyncActivity(({ prompt }) => {
      const now = Date.now();
      firstChangeAt ??= now;
      if (prompt) promptDueAt = now + SYNC_PROMPT_DEBOUNCE_MS;
      const dueAt = Math.min(
        now + SYNC_DEBOUNCE_MS,
        promptDueAt ?? Infinity,
        firstChangeAt + SYNC_MAX_WAIT_MS,
      );
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        firstChangeAt = null;
        promptDueAt = null;
        void sync();
      }, dueAt - now);
    });

    // Back at the window: pull what other devices did meanwhile.
    const onFocus = () => syncOnReturn();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") syncOnReturn();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Periodic re-sync keeps long sessions converged.
    const periodicTimer = window.setInterval(() => {
      void sync();
    }, SYNC_PERIODIC_MS);

    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      window.clearInterval(periodicTimer);
    };
  }, [sync, syncOnReturn]);

  const clearPersistentFailure = useCallback(() => {
    setPersistentFailure(null);
  }, []);

  return { persistentFailure, clearPersistentFailure, syncNow: sync, syncOnReturn };
}
