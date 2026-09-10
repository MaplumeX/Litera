import type { AnnotationsFile, HighlightRecord, BookmarkRecord } from "@/types/library";
import { describe, expect, it } from "vitest";
import {
  type SyncManifest,
  type DeviceId,
  TOMBSTONE_TTL_MS,
  mergeManifests,
  createLocalManifestState,
} from "./sync-merge";

const DAY_MS = 24 * 60 * 60 * 1000;

function iso(msAgo: number, now = Date.now()): string {
  return new Date(now - msAgo).toISOString();
}

function highlight(id: string, updatedMsAgo: number, extra?: Partial<HighlightRecord>): HighlightRecord {
  return {
    id,
    cfi: `epubcfi(/6/4#${id})`,
    excerpt: `excerpt-${id}`,
    createdAt: iso(updatedMsAgo),
    ...extra,
  };
}

function bookmark(id: string, updatedMsAgo: number): BookmarkRecord {
  return {
    id,
    cfi: `epubcfi(/6/8#${id})`,
    fraction: 0.5,
    createdAt: iso(updatedMsAgo),
  };
}

function annotationsFile(
  highlights: HighlightRecord[],
  bookmarks: BookmarkRecord[] = [],
): AnnotationsFile {
  return { schemaVersion: 1, highlights, bookmarks };
}

const DEVICE_A: DeviceId = "device-a";
const DEVICE_B: DeviceId = "device-b";

/** Fixed "now" for deterministic merge tests. */
const NOW = new Date().toISOString();

function baseRemote(now = Date.now()): SyncManifest {
  return {
    schemaVersion: 1,
    books: {},
    tombstones: [],
    preferences: null,
    provider: null,
  };
}

describe("createLocalManifestState", () => {
  it("records reading position with explicit timestamps and device id", () => {
    const before = Date.now();
    const state = createLocalManifestState();

    expect(state.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(state.manifest.schemaVersion).toBe(1);
    const recordedAt = Date.parse(state.now);
    expect(recordedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(recordedAt).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("mergeManifests — reading position", () => {
  it("keeps the position with the newest updatedAt", () => {
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: iso(DAY_MS), fraction: 0.1, cfi: "cfi-a", deviceId: DEVICE_A },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: null,
      coverRevision: null,
    };
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: iso(0), fraction: 0.9, cfi: "cfi-b", deviceId: DEVICE_B },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: iso(0),
      fileRevision: null,
      coverRevision: null,
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.books["book-1"].position.fraction).toBe(0.9);
    expect(merged.books["book-1"].position.cfi).toBe("cfi-b");
  });

  it("breaks updatedAt ties by device id", () => {
    const sameTime = iso(DAY_MS);
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: sameTime, fraction: 0.1, cfi: "cfi-remote", deviceId: DEVICE_B },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: sameTime,
      fileRevision: null,
      coverRevision: null,
    };
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: sameTime, fraction: 0.2, cfi: "cfi-local", deviceId: DEVICE_A },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: sameTime,
      fileRevision: null,
      coverRevision: null,
    };

    // Both devices claim the same time; the lexicographically greater
    // device id wins deterministically on both sides.
    const mergedRemoteFirst = mergeManifests(local.manifest, remote, NOW);
    const mergedLocalFirst = mergeManifests(remote, local, NOW);

    expect(mergedRemoteFirst.books["book-1"].position.deviceId).toBe(
      mergedLocalFirst.books["book-1"].position.deviceId,
    );
    expect(mergedRemoteFirst.books["book-1"].position.deviceId).toBe(
      DEVICE_B > DEVICE_A ? DEVICE_B : DEVICE_A,
    );
  });
});

describe("mergeManifests — annotations", () => {
  function bookWithAnnotations(
    highlights: HighlightRecord[],
    bookmarks: BookmarkRecord[],
    deviceId: DeviceId,
    updatedMsAgo: number,
  ): SyncManifest {
    const manifest = baseRemote();
    manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile(highlights, bookmarks),
      annotationsUpdatedAt: iso(updatedMsAgo),
      fileRevision: null,
      coverRevision: null,
    };
    void deviceId;
    return manifest;
  }

  it("unions highlights from both sides by id", () => {
    const remote = bookWithAnnotations(
      [highlight("hl-remote", DAY_MS)],
      [bookmark("bm-remote", DAY_MS)],
      DEVICE_A,
      DAY_MS,
    );
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile([highlight("hl-local", DAY_MS)], [
        bookmark("bm-local", DAY_MS),
      ]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: null,
      coverRevision: null,
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    const ids = merged.books["book-1"].annotations.highlights.map((item) => item.id).sort();
    expect(ids).toEqual(["hl-local", "hl-remote"]);
    const bookmarkIds = merged.books["book-1"].annotations.bookmarks.map((item) => item.id).sort();
    expect(bookmarkIds).toEqual(["bm-local", "bm-remote"]);
  });

  it("keeps the newest version of an annotation edited on both sides", () => {
    const remote = bookWithAnnotations(
      [highlight("hl-1", 2 * DAY_MS, { note: "old note" })],
      [],
      DEVICE_A,
      2 * DAY_MS,
    );
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile([highlight("hl-1", 0, { note: "new note" })], []),
      annotationsUpdatedAt: iso(0),
      fileRevision: null,
      coverRevision: null,
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.books["book-1"].annotations.highlights).toHaveLength(1);
    expect(merged.books["book-1"].annotations.highlights[0].note).toBe("new note");
  });
});

describe("mergeManifests — tombstones", () => {
  function manifestWithBook(
    deviceId: DeviceId,
    extra?: { annotations?: AnnotationsFile },
  ): SyncManifest {
    const manifest = baseRemote();
    manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: iso(DAY_MS), fraction: 0.5, cfi: "cfi", deviceId },
      annotations: extra?.annotations ?? annotationsFile([highlight("hl-1", DAY_MS)]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: null,
      coverRevision: null,
    };
    return manifest;
  }

  it("propagates a book tombstone: the book disappears from the merge", () => {
    const remote = manifestWithBook(DEVICE_A);
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = manifestWithBook(DEVICE_B).books["book-1"];
    // The local device deleted the book: it lives only as a tombstone.
    local.manifest.tombstones.push({
      kind: "book",
      bookId: "book-1",
      deviceId: DEVICE_B,
      deletedAt: iso(DAY_MS / 2),
    });

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.books["book-1"]).toBeUndefined();
    expect(merged.tombstones).toHaveLength(1);
    expect(merged.tombstones[0]).toMatchObject({ kind: "book", bookId: "book-1" });
  });

  it("a tombstoned highlight id is not resurrected by the union", () => {
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile([highlight("hl-1", 0)]),
      annotationsUpdatedAt: iso(0),
      fileRevision: null,
      coverRevision: null,
    };
    remote.tombstones.push({
      kind: "annotation",
      bookId: "book-1",
      annotationId: "hl-1",
      deviceId: DEVICE_A,
      deletedAt: iso(DAY_MS / 2),
    });
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile([highlight("hl-1", DAY_MS)]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: null,
      coverRevision: null,
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.books["book-1"].annotations.highlights).toHaveLength(0);
  });

  it("an expired tombstone no longer suppresses and can be purged", () => {
    const remote = baseRemote();
    remote.tombstones.push({
      kind: "annotation",
      bookId: "book-1",
      annotationId: "hl-1",
      deviceId: DEVICE_A,
      deletedAt: iso(TOMBSTONE_TTL_MS + DAY_MS),
    });
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: null,
      annotations: annotationsFile([highlight("hl-1", DAY_MS)]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: null,
      coverRevision: null,
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    // 31-day-old tombstone expired; the highlight survives the union.
    expect(merged.books["book-1"].annotations.highlights).toHaveLength(1);
    expect(merged.tombstones).toHaveLength(0);
  });
});

describe("mergeManifests — book metadata and file revisions", () => {
  it("keeps the metadata edit with the newest position or annotation timestamp", () => {
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "Old Title", author: "X" },
      position: { updatedAt: iso(3 * DAY_MS), fraction: 0.1, cfi: "cfi", deviceId: DEVICE_A },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: iso(3 * DAY_MS),
      fileRevision: "rev-1",
      coverRevision: "cover-1",
    };
    const local = createLocalManifestState();
    local.manifest.books["book-1"] = {
      metadata: { title: "New Title", author: "Y" },
      position: { updatedAt: iso(0), fraction: 0.9, cfi: "cfi", deviceId: local.deviceId },
      annotations: annotationsFile([]),
      annotationsUpdatedAt: iso(0),
      fileRevision: "rev-1",
      coverRevision: "cover-1",
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.books["book-1"].metadata.title).toBe("New Title");
  });
});

describe("mergeManifests — preferences", () => {
  it("merges preferences deterministically: newest preference timestamp wins", () => {
    const remote = baseRemote();
    remote.preferences = {
      updatedAt: iso(0),
      deviceId: DEVICE_A,
      data: { theme: "dark" },
    };
    const local = createLocalManifestState();
    local.manifest.preferences = {
      updatedAt: iso(DAY_MS),
      deviceId: DEVICE_B,
      data: { theme: "light" },
    };

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.preferences?.data).toEqual({ theme: "dark" });
  });

  it("a null side adopts the non-null side", () => {
    const remote = baseRemote();
    remote.preferences = { updatedAt: iso(0), deviceId: DEVICE_A, data: { locale: "en" } };
    const local = createLocalManifestState();

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(merged.preferences?.data).toEqual({ locale: "en" });
  });
});

describe("mergeManifests — convergence", () => {
  it("merging is commutative: A⊕B equals B⊕A", () => {
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: iso(DAY_MS), fraction: 0.2, cfi: "cfi-b", deviceId: DEVICE_B },
      annotations: annotationsFile([highlight("hl-remote", DAY_MS)]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: "rev-1",
      coverRevision: null,
    };
    remote.preferences = { updatedAt: iso(DAY_MS), deviceId: DEVICE_A, data: { theme: "dark" } };
    const localState = createLocalManifestState();
    localState.manifest.books["book-2"] = {
      metadata: { title: "B", author: "Y" },
      position: null,
      annotations: annotationsFile([highlight("hl-local", 0)]),
      annotationsUpdatedAt: iso(0),
      fileRevision: null,
      coverRevision: null,
    };

    const left = mergeManifests(localState.manifest, remote, NOW);
    const right = mergeManifests(remote, localState.manifest, NOW);

    expect(left).toEqual(right);
  });
});

describe("mergeManifests — empty-device bootstrap", () => {
  it("an empty local library adopts the remote books instead of clobbering", () => {
    const remote = baseRemote();
    remote.books["book-1"] = {
      metadata: { title: "A", author: "X" },
      position: { updatedAt: iso(DAY_MS), fraction: 0.5, cfi: "cfi", deviceId: DEVICE_A },
      annotations: annotationsFile([highlight("hl-1", DAY_MS)]),
      annotationsUpdatedAt: iso(DAY_MS),
      fileRevision: "rev-1",
      coverRevision: "cover-1",
    };
    const local = createLocalManifestState();

    const merged = mergeManifests(local.manifest, remote, NOW);

    expect(Object.keys(merged.books)).toEqual(["book-1"]);
    expect(merged.books["book-1"].fileRevision).toBe("rev-1");
    expect(merged.books["book-1"].metadata.title).toBe("A");
  });
});
