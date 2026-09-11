import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { invokeErrorMessage } from "@/lib/app-error";
import { runSyncOnce } from "@/lib/sync-runner";
import { subscribeSyncActivity } from "@/lib/sync-activity";

/** Local changes settle down before pushing (page turns don't spam). */
export const SYNC_DEBOUNCE_MS = 30_000;
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
}

/**
 * Automatic Sync cadence: run at app startup when Sync is enabled, push a
 * debounced sync after local changes settle, and re-sync periodically. All
 * runs are silent; only repeated consecutive failures surface to the UI.
 */
export function useSyncScheduler(): SyncScheduler {
  const [persistentFailure, setPersistentFailure] = useState<string | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const runningRef = useRef(false);

  const sync = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const config = await invoke<SyncConfigLike | null>("get_sync_config");
      if (!config?.enabled) return;
      await runSyncOnce({ uploadFiles: true });
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
    } finally {
      runningRef.current = false;
    }
  }, []);

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

    // Local changes: debounced push after things settle down.
    let debounceTimer: number | null = null;
    const unsubscribe = subscribeSyncActivity(() => {
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void sync();
      }, SYNC_DEBOUNCE_MS);
    });

    // Periodic re-sync keeps long sessions converged.
    const periodicTimer = window.setInterval(() => {
      void sync();
    }, SYNC_PERIODIC_MS);

    return () => {
      disposed = true;
      unsubscribe();
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      window.clearInterval(periodicTimer);
    };
  }, [sync]);

  const clearPersistentFailure = useCallback(() => {
    setPersistentFailure(null);
  }, []);

  return { persistentFailure, clearPersistentFailure };
}
