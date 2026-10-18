// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSyncOnce, syncBeforeExit } from "./sync-runner";
import { hasUnsyncedActivity, notifySyncActivity } from "./sync-activity";

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
      case "sync_upload_book_files":
        return Promise.resolve({ books: 0, covers: 0, bytes: 0 });
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
  it("uploads pending book files first when asked to transfer them", async () => {
    setupStore();

    await runSyncOnce({ uploadFiles: true });

    const commands = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(commands[0]).toBe("sync_upload_book_files");
    expect(commands).toContain("sync_upload_manifest");
  });

  it("syncs the Manifest and Sessions without transferring book files", async () => {
    setupStore();

    await runSyncOnce({ uploadFiles: false });

    const commands = invokeMock.mock.calls.map(([cmd]) => cmd);
    expect(commands).not.toContain("sync_upload_book_files");
    expect(commands).not.toContain("sync_download_book_file");
    expect(commands).toContain("sync_upload_manifest");
    expect(commands).toContain("sync_sessions");
  });

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

  it("announces synced preferences so the app can switch language live", async () => {
    const store = setupStore();
    // The remote envelope is newer and carries the language another device
    // set — the merge adopts it and the event must surface it.
    store.remote = {
      ...remoteManifest(),
      preferences: {
        updatedAt: "2026-01-03T00:00:00Z",
        deviceId: "device-b",
        data: { theme: "dark", language: "en" },
      },
    };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sync_export_local_manifest") return Promise.resolve(structuredClone(store.local));
      if (cmd === "sync_download_manifest")
        return Promise.resolve({ etag: "etag-1", manifest: structuredClone(store.remote) });
      return Promise.resolve(null);
    });
    const events: Array<{ language?: string; preferencesSynced?: boolean }> = [];
    window.addEventListener("litera:sync-applied", (event) => {
      events.push((event as CustomEvent<{ language?: string; preferencesSynced?: boolean }>).detail);
    });

    await runSyncOnce();

    expect(events).toHaveLength(1);
    expect(events[0].language).toBe("en");
    expect(events[0].preferencesSynced).toBe(true);
  });

  it("announces every applied sync even without preferences, for the shelf refresh", async () => {
    const store = setupStore();
    store.local = { ...localManifest(), preferences: null };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sync_export_local_manifest") return Promise.resolve(structuredClone(store.local));
      if (cmd === "sync_download_manifest")
        return Promise.resolve({ etag: "etag-1", manifest: structuredClone(store.remote) });
      return Promise.resolve(null);
    });
    const events: Array<{ language?: string; preferencesSynced?: boolean }> = [];
    window.addEventListener("litera:sync-applied", (event) => {
      events.push((event as CustomEvent<{ language?: string; preferencesSynced?: boolean }>).detail);
    });

    await runSyncOnce();

    expect(events).toHaveLength(1);
    expect(events[0].preferencesSynced).toBe(false);
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

describe("pass serialization", () => {
  it("never overlaps two passes, even when started together", async () => {
    setupStore();
    const base = invokeMock.getMockImplementation()!;
    let inFlight = 0;
    let maxInFlight = 0;
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "sync_export_local_manifest") {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      }
      // Let the other pass get scheduled while this one is mid-flight.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = await base(cmd, args);
      if (cmd === "sync_sessions") inFlight -= 1;
      return result;
    });

    await Promise.all([runSyncOnce(), runSyncOnce()]);

    expect(maxInFlight).toBe(1);
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === "sync_sessions")).toHaveLength(2);
  });

  it("keeps running queued passes after one fails", async () => {
    setupStore();
    const base = invokeMock.getMockImplementation()!;
    let failNext = true;
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "sync_download_manifest" && failNext) {
        failNext = false;
        return Promise.reject(new Error("offline"));
      }
      return base(cmd, args);
    });

    const first = runSyncOnce();
    const second = runSyncOnce();

    await expect(first).rejects.toThrow("offline");
    await expect(second).resolves.toBeUndefined();
  });
});

describe("syncBeforeExit", () => {
  it("pushes only when something changed since the last pass", async () => {
    setupStore();
    const base = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) =>
      cmd === "get_sync_config" ? Promise.resolve({ enabled: true }) : base(cmd, args),
    );
    await runSyncOnce();
    invokeMock.mockClear();

    await syncBeforeExit(1_000);
    expect(invokeMock).not.toHaveBeenCalled();

    notifySyncActivity();
    await syncBeforeExit(1_000);
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toContain("sync_upload_manifest");
    // A pre-exit push never uploads book files.
    expect(invokeMock.mock.calls.map(([cmd]) => cmd)).not.toContain("sync_upload_book_files");
    expect(hasUnsyncedActivity()).toBe(false);
  });

  it("gives up waiting after the timeout instead of holding the window open", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "get_sync_config"
        ? Promise.resolve({ enabled: true })
        : new Promise(() => {
            // The Sync Backend never answers.
          }),
    );
    notifySyncActivity();

    await expect(syncBeforeExit(10)).resolves.toBeUndefined();
  });
});
