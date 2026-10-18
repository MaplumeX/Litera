import { invoke } from "@tauri-apps/api/core";
import { mergeManifests, type SyncManifest } from "./sync-merge";
import { hasUnsyncedActivity, takeUnsyncedActivity } from "./sync-activity";

/** Bounded retries for etag conflicts on the conditional Manifest PUT. */
const MAX_SYNC_ATTEMPTS = 3;

interface DownloadedManifest {
  etag: string;
  manifest: SyncManifest;
}

function isPreconditionFailure(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.toLowerCase().includes("precondition")) {
      return true;
    }
    const code = (error as { code?: unknown }).code;
    if (code === "Precondition") return true;
  }
  return false;
}

/**
 * One full sync pass: optionally upload pending book files first (so the
 * Manifest carries their fresh revisions), then export local → download
 * remote → merge (pure) → apply merged locally → upload merged with `If-Match`
 * on the downloaded etag, retrying the download+merge+upload loop on
 * precondition conflicts.
 */
export function runSyncOnce(options: { uploadFiles?: boolean } = {}): Promise<void> {
  // Passes never overlap — the scheduler, "Sync now" in Settings, and the
  // pre-exit push all queue here. Two concurrent passes would race on the
  // same local sync state and Manifest.
  const run = passQueue.catch(() => {}).then(() => runPass(options));
  passQueue = run;
  return run;
}

let passQueue: Promise<void> = Promise.resolve();

async function runPass(options: { uploadFiles?: boolean }): Promise<void> {
  const activity = takeUnsyncedActivity();
  try {
    await runPassSteps(options);
  } catch (error) {
    activity.restore();
    throw error;
  }
}

/**
 * Push local changes before the app exits, bounded by `timeoutMs` so a slow
 * or unreachable Sync Backend never holds the window open. Skips when Sync is
 * off or nothing changed since the last pass.
 */
export async function syncBeforeExit(timeoutMs: number): Promise<void> {
  if (!hasUnsyncedActivity()) return;
  const config = await invoke<{ enabled: boolean } | null>("get_sync_config");
  if (!config?.enabled) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      // Book files can be large: they wait for the next launch.
      runSyncOnce({ uploadFiles: false }),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPassSteps(options: { uploadFiles?: boolean }): Promise<void> {
  if (options.uploadFiles) {
    await invoke("sync_upload_book_files");
  }
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    const local = await invoke<SyncManifest>("sync_export_local_manifest");
    const downloaded = await invoke<DownloadedManifest>("sync_download_manifest");
    const merged = mergeManifests(local, downloaded.manifest, new Date().toISOString());

    await invoke("sync_apply_merged_manifest", {
      manifest: merged,
      // The pre-merge local snapshot: Rust uses it to avoid clobbering
      // local edits that happened while the network round trip was in flight.
      base: local,
      etag: downloaded.etag,
    });
    // Tell the app a sync landed: the shelf re-reads the Library and an
    // open book reloads its annotations.
    window.dispatchEvent(new CustomEvent("litera:sync-applied"));

    try {
      await invoke("sync_upload_manifest", {
        manifest: merged,
        etag: downloaded.etag,
      });
      // Sessions sync after the Manifest converges: upload locally changed
      // session files, download and merge (union, both branches kept) remote
      // ones.
      await invoke("sync_sessions");
      return;
    } catch (error) {
      if (attempt < MAX_SYNC_ATTEMPTS - 1 && isPreconditionFailure(error)) {
        continue;
      }
      throw error;
    }
  }
}

/** How long leaving (closing the window, going to the background) may wait on the final pushes. */
export const PUSH_BEFORE_LEAVING_TIMEOUT_MS = 5_000;

/**
 * The last pushes before the app goes away: pending Sync changes and the
 * KOReader position, side by side, each bounded so leaving never hangs.
 */
export async function pushBeforeLeaving(flushKosync: () => Promise<void>): Promise<void> {
  await Promise.all([
    syncBeforeExit(PUSH_BEFORE_LEAVING_TIMEOUT_MS).catch((error: unknown) => {
      console.warn("Sync before leaving failed:", error);
    }),
    Promise.race([
      flushKosync(),
      new Promise((resolve) => setTimeout(resolve, PUSH_BEFORE_LEAVING_TIMEOUT_MS)),
    ]),
  ]);
}
