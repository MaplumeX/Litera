import { invoke } from "@tauri-apps/api/core";
import { mergeManifests, type SyncManifest } from "./sync-merge";

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
 * One full sync pass: export local → download remote → merge (pure) →
 * apply merged locally → upload merged with `If-Match` on the downloaded
 * etag, retrying the download+merge+upload loop on precondition conflicts.
 */
export async function runSyncOnce(): Promise<void> {
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

    try {
      await invoke("sync_upload_manifest", {
        manifest: merged,
        etag: downloaded.etag,
      });
      return;
    } catch (error) {
      if (attempt < MAX_SYNC_ATTEMPTS - 1 && isPreconditionFailure(error)) {
        continue;
      }
      throw error;
    }
  }
}
