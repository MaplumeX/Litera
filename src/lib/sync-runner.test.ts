// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSyncOnce } from "./sync-runner";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

interface Store {
  local: unknown;
  remote: unknown;
  etag: string;
  uploadCalls: Array<{ etag: string; manifest: unknown }>;
  uploadedManifest?: unknown;
}

function remoteManifest(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    books: {
      "book-remote": {
        metadata: { title: "Remote", author: "R" },
        position: {
          updatedAt: "2026-01-02T00:00:00Z",
          deviceId: "device-b",
          fraction: 0.7,
          cfi: "cfi-remote",
        },
        annotations: { schemaVersion: 1, highlights: [], bookmarks: [] },
        annotationsUpdatedAt: "2026-01-02T00:00:00Z",
        fileRevision: null,
        coverRevision: null,
      },
    },
    tombstones: [],
    preferences: null,
    provider: null,
    ...overrides,
  };
}

function localManifest() {
  return {
    schemaVersion: 1,
    books: {
      "book-local": {
        metadata: { title: "Local", author: "L" },
        position: null,
        annotations: { schemaVersion: 1, highlights: [], bookmarks: [] },
        annotationsUpdatedAt: "2026-01-01T00:00:00Z",
        fileRevision: null,
        coverRevision: null,
      },
    },
    tombstones: [],
    preferences: null,
    provider: null,
  };
}

function setupStore(): Store {
  const store: Store = {
    local: localManifest(),
    remote: remoteManifest(),
    etag: "etag-1",
    uploadCalls: [],
  };
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "sync_export_local_manifest":
        return Promise.resolve(structuredClone(store.local));
      case "sync_download_manifest":
        return Promise.resolve({
          etag: store.etag,
          manifest: structuredClone(store.remote),
        });
      case "sync_apply_merged_manifest":
        return Promise.resolve(null);
      case "sync_sessions":
        return Promise.resolve({ uploaded: 0, downloaded: 0 });
      case "sync_upload_manifest": {
        const upload = {
          etag: args?.etag as string,
          manifest: args?.manifest,
        };
        store.uploadCalls.push(upload);
        store.uploadedManifest = args?.manifest;
        return Promise.resolve(null);
      }
      default:
        return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    }
  });
  return store;
}

beforeEach(() => {
  invokeMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runSyncOnce", () => {
  it("downloads, merges, applies, and uploads with the downloaded etag", async () => {
    const store = setupStore();

    await runSyncOnce();

    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
      "sync_export_local_manifest",
      "sync_download_manifest",
      "sync_apply_merged_manifest",
      "sync_upload_manifest",
      "sync_sessions",
    ]);
    // Both sides' books survive the merge and reach both apply and upload.
    const applied = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "sync_apply_merged_manifest",
    )![1] as Record<string, unknown>;
    const appliedManifest = applied.manifest as Record<string, { metadata: { title: string } }>;
    expect(Object.keys(appliedManifest.books).sort()).toEqual(["book-local", "book-remote"]);
    expect(appliedManifest.books["book-remote"].metadata.title).toBe("Remote");
    expect(store.uploadCalls).toHaveLength(1);
    expect(store.uploadCalls[0].etag).toBe("etag-1");
  });

  it("retries with a fresh download when the etag precondition fails, then converges", async () => {
    const store = setupStore();
    // First PUT conflicts: another device wrote meanwhile.
    let attempts = 0;
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case "sync_export_local_manifest":
          return Promise.resolve(structuredClone(store.local));
        case "sync_download_manifest":
          return Promise.resolve({
            etag: attempts === 0 ? "etag-1" : "etag-2",
            manifest: structuredClone(store.remote),
          });
        case "sync_apply_merged_manifest":
          return Promise.resolve(null);
        case "sync_sessions":
          return Promise.resolve({ uploaded: 0, downloaded: 0 });
        case "sync_upload_manifest": {
          attempts += 1;
          if (attempts === 1) {
            return Promise.reject({ code: "StorageIo", message: "Sync backend error: precondition" });
          }
          store.uploadCalls.push({ etag: args?.etag as string, manifest: args?.manifest });
          return Promise.resolve(null);
        }
        default:
          return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
      }
    });

    await runSyncOnce();

    expect(attempts).toBe(2);
    expect(store.uploadCalls).toHaveLength(1);
    expect(store.uploadCalls[0].etag).toBe("etag-2");
  });

  it("gives up after the bounded retry count and surfaces the error", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      switch (cmd) {
        case "sync_export_local_manifest":
          return Promise.resolve(localManifest());
        case "sync_download_manifest":
          return Promise.resolve({ etag: "etag-1", manifest: remoteManifest() });
        case "sync_apply_merged_manifest":
          return Promise.resolve(null);
        case "sync_sessions":
          return Promise.resolve({ uploaded: 0, downloaded: 0 });
        case "sync_upload_manifest":
          return Promise.reject({
            code: "StorageIo",
            message: "Sync backend error: precondition",
          });
        default:
          return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
      }
    });

    await expect(runSyncOnce()).rejects.toThrow(/precondition/);

    const uploads = invokeMock.mock.calls.filter(([cmd]) => cmd === "sync_upload_manifest");
    expect(uploads.length).toBeGreaterThan(1);
    expect(uploads.length).toBeLessThanOrEqual(5);
  });

  it("passes the pre-merge local snapshot as the apply base", async () => {
    setupStore();

    await runSyncOnce();

    const applied = invokeMock.mock.calls.find(
      ([cmd]) => cmd === "sync_apply_merged_manifest",
    )![1] as Record<string, unknown>;
    // The base is the manifest as it was *before* the merge, so Rust can
    // detect local edits that raced the sync pass.
    expect(applied.base).toEqual(localManifest());
  });

  it("applies the merged manifest before uploading, never after", async () => {
    setupStore();
    const order: string[] = [];
    invokeMock.mockImplementation((cmd: string) => {
      order.push(cmd);
      if (cmd === "sync_export_local_manifest") return Promise.resolve(localManifest());
      if (cmd === "sync_download_manifest")
        return Promise.resolve({ etag: "etag-1", manifest: remoteManifest() });
      return Promise.resolve(null);
    });

    await runSyncOnce();

    expect(order.indexOf("sync_apply_merged_manifest")).toBeLessThan(
      order.indexOf("sync_upload_manifest"),
    );
  });
});
