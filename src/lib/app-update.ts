import { useEffect, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { isAndroid } from "@/lib/platform";

/**
 * App updates from GitHub Releases. Desktop downloads, installs and restarts
 * through the Tauri updater; Android (which the updater does not support)
 * reads the same manifest and sends the reader to the Releases page for the
 * APK. One module-level state, so the banner and Settings › About agree.
 */

export const AUTO_CHECK_UPDATES_KEY = "litera.autoCheckUpdates";
export const LAST_UPDATE_CHECK_KEY = "litera.lastUpdateCheck";
export const RELEASES_URL = "https://github.com/MaplumeX/Litera/releases";
/** The manifest tauri-action uploads; the desktop updater reads the same URL. */
export const UPDATE_MANIFEST_URL =
  "https://github.com/MaplumeX/Litera/releases/latest/download/latest.json";

/** Automatic checks run at most this often. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Startup is busy (library load, Sync); the automatic check waits this long. */
const AUTO_CHECK_DELAY_MS = 5_000;
const CHECK_TIMEOUT_MS = 15_000;

export type AppUpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "upToDate" }
  /** `error` is a failed install, kept so the reader can retry. */
  | { status: "available"; version: string; dismissed: boolean; error?: string }
  /** `progress` is 0–1, or null while the size is unknown. */
  | { status: "downloading"; version: string; progress: number | null }
  | { status: "installing"; version: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Preferences (device-local, not synced)

export function loadAutoCheckUpdates(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(AUTO_CHECK_UPDATES_KEY) !== "false";
  } catch {
    return true;
  }
}

const autoCheckListeners = new Set<() => void>();

export function saveAutoCheckUpdates(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_CHECK_UPDATES_KEY, String(enabled));
  } catch {
    // private mode / quota
  }
  for (const listener of autoCheckListeners) listener();
}

function subscribeAutoCheck(listener: () => void): () => void {
  autoCheckListeners.add(listener);
  return () => {
    autoCheckListeners.delete(listener);
  };
}

export function useAutoCheckUpdates(): [boolean, typeof saveAutoCheckUpdates] {
  return [
    useSyncExternalStore(subscribeAutoCheck, loadAutoCheckUpdates, loadAutoCheckUpdates),
    saveAutoCheckUpdates,
  ];
}

function loadLastUpdateCheck(): number | null {
  try {
    const raw = localStorage.getItem(LAST_UPDATE_CHECK_KEY);
    const value = raw == null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function saveLastUpdateCheck(at: number): void {
  try {
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(at));
  } catch {
    // private mode / quota
  }
}

/** Due when never checked, a day has passed, or the clock went backwards. */
export function isUpdateCheckDue(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt == null) return true;
  return now - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS || lastCheckedAt > now;
}

// ---------------------------------------------------------------------------
// Versions

function parseVersion(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

/** Whether `latest` is a newer release than `current` (major.minor.patch). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// ---------------------------------------------------------------------------
// State

let state: AppUpdateState = { status: "idle" };
/** The desktop updater's handle for the available release. */
let pendingUpdate: Update | null = null;
const listeners = new Set<() => void>();

function setState(next: AppUpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState(): AppUpdateState {
  return state;
}

export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Desktop installs in place; Android can only open the Releases page. */
export function canInstallInApp(): boolean {
  return !isAndroid();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function findAndroidUpdate(): Promise<string | null> {
  const response = await tauriFetch(UPDATE_MANIFEST_URL, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const manifest: unknown = await response.json();
  const latest =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : null;
  if (typeof latest !== "string") throw new Error("Update manifest has no version");
  return isNewerVersion(latest, await getVersion()) ? latest.replace(/^v/, "") : null;
}

async function findDesktopUpdate(): Promise<string | null> {
  const update = await check({ timeout: CHECK_TIMEOUT_MS });
  void pendingUpdate?.close().catch(() => {});
  pendingUpdate = update;
  return update?.version ?? null;
}

/**
 * Ask GitHub for the latest release. Automatic checks fail silently (offline
 * is normal); a manual one reports the failure and an up-to-date result.
 */
export async function checkForUpdates({ manual = false }: { manual?: boolean } = {}): Promise<void> {
  if (state.status === "checking" || state.status === "downloading" || state.status === "installing") {
    return;
  }
  const previous = state;
  setState({ status: "checking" });
  try {
    const version = canInstallInApp() ? await findDesktopUpdate() : await findAndroidUpdate();
    saveLastUpdateCheck(Date.now());
    if (version) {
      // A release the reader already waved off stays quiet until asked for.
      const dismissed =
        !manual && previous.status === "available" && previous.version === version && previous.dismissed;
      setState({ status: "available", version, dismissed });
    } else {
      setState(manual ? { status: "upToDate" } : { status: "idle" });
    }
  } catch (error) {
    console.warn("Update check failed:", error);
    setState(manual ? { status: "error", message: errorMessage(error) } : previous);
  }
}

/** Hide the banner for the available release; Settings › About still offers it. */
export function dismissUpdate(): void {
  if (state.status === "available") setState({ ...state, dismissed: true });
}

/**
 * Desktop: download, run `beforeRestart` (flush unsaved reading state),
 * install, restart. Android: open the Releases page.
 */
export async function installUpdate(beforeRestart: () => Promise<void>): Promise<void> {
  if (state.status !== "available") return;
  const { version } = state;
  if (!canInstallInApp()) {
    await openUrl(RELEASES_URL).catch((error) => console.error("Failed to open URL:", error));
    return;
  }
  const update = pendingUpdate;
  if (!update) return;
  try {
    let total: number | null = null;
    let received = 0;
    setState({ status: "downloading", version, progress: null });
    await update.download((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        setState({
          status: "downloading",
          version,
          progress: total ? Math.min(received / total, 1) : null,
        });
      }
    });
    setState({ status: "installing", version });
    await beforeRestart();
    // On Windows the installer takes over and exits the app here.
    await update.install();
    await relaunch();
  } catch (error) {
    console.error("Update install failed:", error);
    setState({ status: "available", version, dismissed: false, error: errorMessage(error) });
  }
}

/** Run the automatic check once, shortly after startup, when enabled and due. */
export function useAutoUpdateCheck(): void {
  useEffect(() => {
    if (!loadAutoCheckUpdates() || !isUpdateCheckDue(loadLastUpdateCheck(), Date.now())) return;
    const timer = setTimeout(() => void checkForUpdates(), AUTO_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
}

/** Tests only: back to the startup state. */
export function resetAppUpdateForTests(): void {
  pendingUpdate = null;
  state = { status: "idle" };
}
