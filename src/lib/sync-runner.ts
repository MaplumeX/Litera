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
  passesPending += 1;
  const run = passQueue
    .catch(() => {})
    .then(() => runPass(options))
    .finally(() => {
      passesPending -= 1;
    });
  passQueue = run;
  return run;
}

let passQueue: Promise<void> = Promise.resolve();
/** Passes queued or running. */
let passesPending = 0;
/** When the last pass finished without error (ms since epoch). */
let lastPassSucceededAt: number | null = null;

async function runPass(options: { uploadFiles?: boolean }): Promise<void> {
  const activity = takeUnsyncedActivity();
  try {
    await runPassSteps(options);
    lastPassSucceededAt = Date.now();
  } catch (error) {
    activity.restore();
    throw error;
  }
}

/** A pass that finished this recently counts as current when opening a Book. */
export const PULL_BEFORE_OPEN_FRESH_MS = 30_000;
/** How long opening a Book may wait on its pull. */
export const PULL_BEFORE_OPEN_TIMEOUT_MS = 3_000;

/**
 * Pull before opening a Book, so it opens at the position (and with the
 * Annotations) another device left it at. Waits on a pass already underway
 * instead of queueing another, skips when a pass just finished, and is
 * bounded by `timeoutMs` so an unreachable Sync Backend only delays opening
 * briefly. Never throws.
 */
export async function pullBeforeOpen(
  timeoutMs: number = PULL_BEFORE_OPEN_TIMEOUT_MS,
): Promise<void> {
  if (
    passesPending === 0 &&
    lastPassSucceededAt !== null &&
    Date.now() - lastPassSucceededAt < PULL_BEFORE_OPEN_FRESH_MS
  ) {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = await invoke<{ enabled: boolean } | null>("get_sync_config");
    if (!config?.enabled) return;
    // Book files can be large: they go with the scheduler's next pass.
    const pass = passesPending > 0 ? passQueue : runSyncOnce({ uploadFiles: false });
    await Promise.race([
      pass,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn("Sync before opening a book failed:", error);
  } finally {
    if (timer) clearTimeout(timer);
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
      // Open agent conversations pick up messages from other devices.
      window.dispatchEvent(new CustomEvent("litera:sessions-synced"));
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
