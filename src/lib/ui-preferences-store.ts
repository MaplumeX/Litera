import { invoke } from "@tauri-apps/api/core";

export interface UiPreferencesSnapshot {
  uiFontSize?: number;
  uiFontFamily?: string;
  /** Empty string means explicitly set to follow the interface font. */
  chatFontFamily?: string;
  uiAccent?: string;
}

export type UiPreferenceKey = keyof UiPreferencesSnapshot;

const listeners = new Set<() => void>();
const dirtyKeys = new Set<UiPreferenceKey>();

let pendingPatch: UiPreferencesSnapshot = {};
let activeDrain: Promise<void> | null = null;

function hasTauriInternals(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function drainWrites(): Promise<void> {
  if (activeDrain) return activeDrain;
  const run = (async () => {
    try {
      while (Object.keys(pendingPatch).length > 0) {
        const batch = pendingPatch;
        pendingPatch = {};
        try {
          await invoke("save_ui_preferences", { ...batch });
        } catch (error) {
          if (hasTauriInternals()) {
            console.error("Failed to save UI preferences:", error);
          }
        }
      }
    } finally {
      activeDrain = null;
      if (Object.keys(pendingPatch).length > 0) {
        void drainWrites();
      }
    }
  })();
  activeDrain = run;
  return run;
}

/**
 * Mirror UI chrome preferences (fonts, size, accent) to Rust-backed disk
 * storage immediately. Writes are serialized and coalesced so rapid slider
 * changes stay ordered without waiting on a debounce timer.
 */
export function persistUiPreferences(
  patch: UiPreferencesSnapshot,
  options: { markDirty?: boolean } = {},
): void {
  const { markDirty = true } = options;
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  for (const [key] of entries) {
    if (markDirty) dirtyKeys.add(key as UiPreferenceKey);
  }
  pendingPatch = { ...pendingPatch, ...Object.fromEntries(entries) };
  void drainWrites();
}

/** Wait for every queued `save_ui_preferences` write to finish on disk. */
export async function flushUiPreferences(): Promise<void> {
  while (activeDrain || Object.keys(pendingPatch).length > 0) {
    await (activeDrain ?? drainWrites());
  }
}

export async function readUiPreferencesFromDisk(): Promise<UiPreferencesSnapshot | null> {
  try {
    const result = await invoke<UiPreferencesSnapshot | null>("get_ui_preferences");
    return result && typeof result === "object" ? result : null;
  } catch (error) {
    if (hasTauriInternals()) {
      console.error("Failed to load UI preferences:", error);
    }
    return null;
  }
}

export function isUiPreferenceDirty(key: UiPreferenceKey): boolean {
  return dirtyKeys.has(key);
}

export function subscribeUiPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyUiPreferences(): void {
  for (const listener of listeners) listener();
}

/** Reset module-level queue and dirty tracking between unit tests. */
export function resetUiPreferencesForTests(): void {
  pendingPatch = {};
  activeDrain = null;
  dirtyKeys.clear();
  listeners.clear();
}
