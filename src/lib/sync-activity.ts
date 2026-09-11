/**
 * Local-change signal for Sync: writers (annotations, reading positions,
 * sessions, preferences, imports) notify after persisting, and the sync
 * scheduler debounces these into a push. Pure pub/sub — no Tauri, no state.
 */

const listeners = new Set<() => void>();

/** Notify that synced data changed locally and should eventually push. */
export function notifySyncActivity(): void {
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
