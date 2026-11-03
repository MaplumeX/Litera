import { useSyncExternalStore } from "react";

// Device preference only: never synced. Not in preferences.json, whose parser
// rejects unknown keys, so a new key there would reset an older build's settings.
export const READING_STATS_ENABLED_KEY = "litera.readingStatsEnabled";

const listeners = new Set<() => void>();

/** On unless the reader turned it off. */
export function loadReadingStatsEnabled(): boolean {
  try {
    return localStorage.getItem(READING_STATS_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveReadingStatsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(READING_STATS_ENABLED_KEY, String(enabled));
  } catch {
    // Storage unavailable: nothing to keep it in.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReadingStatsEnabled(): [boolean, typeof saveReadingStatsEnabled] {
  return [
    useSyncExternalStore(subscribe, loadReadingStatsEnabled, loadReadingStatsEnabled),
    saveReadingStatsEnabled,
  ];
}

// Whether the one-time notice about the log reaching the Sync Backend is due.
const LOG_NOTICE_KEY = "litera.readingLogSyncNotice";

function readLogNotice(): string | null {
  try {
    return localStorage.getItem(LOG_NOTICE_KEY);
  } catch {
    return "dismissed";
  }
}

function writeLogNotice(value: "pending" | "dismissed"): void {
  try {
    localStorage.setItem(LOG_NOTICE_KEY, value);
  } catch {
    // Storage unavailable: the notice cannot be remembered either way.
  }
  for (const listener of listeners) listener();
}

/** The log was uploaded: the first time, the reader gets to hear about it. */
export function noteReadingLogUploaded(): void {
  if (readLogNotice() === null) writeLogNotice("pending");
}

export function useReadingLogSyncNotice(): { due: boolean; dismiss: () => void } {
  const due = useSyncExternalStore(
    subscribe,
    () => readLogNotice() === "pending",
    () => false,
  );
  return { due, dismiss: () => writeLogNotice("dismissed") };
}
