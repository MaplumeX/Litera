import { invoke } from "@tauri-apps/api/core";
import { getLocale } from "./i18n";
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
 * One full sync pass: optionally upload pending book files first (so the
 * Manifest carries their fresh revisions), then export local → download
 * remote → merge (pure) → apply merged locally → upload merged with `If-Match`
 * on the downloaded etag, retrying the download+merge+upload loop on
 * precondition conflicts.
 */
export async function runSyncOnce(
  options: { uploadFiles?: boolean } = {},
): Promise<void> {
  if (options.uploadFiles) {
    await invoke("sync_upload_book_files");
  }
  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
    const local = await invoke<SyncManifest>("sync_export_local_manifest", {
      locale: getLocale(),
    });
    const downloaded = await invoke<DownloadedManifest>("sync_download_manifest");
    const merged = mergeManifests(local, downloaded.manifest, new Date().toISOString());

    await invoke("sync_apply_merged_manifest", {
      manifest: merged,
      // The pre-merge local snapshot: Rust uses it to avoid clobbering
      // local edits that happened while the network round trip was in flight.
      base: local,
      etag: downloaded.etag,
    });
    // Synced preferences (and the UI language riding in the envelope) apply
    // without a restart: tell the app to re-read them.
    if (merged.preferences) {
      const language = (merged.preferences.data as { language?: string } | null)?.language;
      window.dispatchEvent(
        new CustomEvent("litera:sync-applied", { detail: { language } }),
      );
    }

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
