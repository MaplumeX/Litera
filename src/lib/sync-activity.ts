/**
 * Local-change signal for Sync: writers (annotations, reading positions,
 * sessions, preferences, imports) notify after persisting, and the sync
 * scheduler debounces these into a push. Pure pub/sub — no Tauri, no state.
 */

const listeners = new Set<() => void>();
/** Whether local changes happened since the last sync pass started. */
let unsynced = false;

/** Notify that synced data changed locally and should eventually push. */
export function notifySyncActivity(): void {
  unsynced = true;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("sync activity listener failed:", error);
    }
  }
}

export function subscribeSyncActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether local changes are waiting for a sync pass. */
export function hasUnsyncedActivity(): boolean {
  return unsynced;
}

/**
 * Take the pending-changes mark at the start of a pass; `restore` puts it
 * back when the pass fails, so the changes still count as unsynced.
 */
export function takeUnsyncedActivity(): { restore: () => void } {
  const had = unsynced;
  unsynced = false;
  return {
    restore: () => {
      if (had) unsynced = true;
    },
  };
}
