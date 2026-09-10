import type { AnnotationsFile } from "@/types/library";

/**
 * Sync merge engine — pure functions, no I/O.
 *
 * Merges the local Manifest with the remote Manifest per ADR
 * docs/adr/0001-s3-sync.md: annotations union by id, reading position
 * newest-wins, tombstones suppress deletions for 30 days, diverged data
 * unions rather than clobbers.
 */

export const MANIFEST_SCHEMA_VERSION = 1;

/** Tombstones older than this no longer suppress and may be purged. */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type DeviceId = string;

export interface BookMetadataSync {
  title: string;
  author: string;
  [key: string]: unknown;
}

export interface ReadingPositionSync {
  /** Explicit recorded timestamp — never derived from file mtime. */
  updatedAt: string;
  deviceId: DeviceId;
  fraction: number;
  cfi: string;
}

export interface SyncedBook {
  metadata: BookMetadataSync;
  position: ReadingPositionSync | null;
  annotations: AnnotationsFile;
  annotationsUpdatedAt: string;
  fileRevision: string | null;
  coverRevision: string | null;
}

export type TombstoneKind = "book" | "annotation";

export interface Tombstone {
  kind: TombstoneKind;
  bookId: string;
  /** Present for annotation tombstones only. */
  annotationId?: string;
  deviceId: DeviceId;
  deletedAt: string;
}

export interface PreferenceEnvelope<T = Record<string, unknown>> {
  updatedAt: string;
  deviceId: DeviceId;
  data: T;
}

export interface SyncManifest {
  schemaVersion: number;
  books: Record<string, SyncedBook>;
  tombstones: Tombstone[];
  preferences: PreferenceEnvelope | null;
  provider: PreferenceEnvelope | null;
}

export interface LocalSyncState {
  deviceId: DeviceId;
  manifest: SyncManifest;
  /** Snapshot of "now" so merge outcomes are stable within one sync pass. */
  now: string;
}

function emptyManifest(): SyncManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    books: {},
    tombstones: [],
    preferences: null,
    provider: null,
  };
}

function randomDeviceId(): DeviceId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Deterministic fallback for environments without randomUUID.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createLocalManifestState(): LocalSyncState {
  return {
    deviceId: randomDeviceId(),
    manifest: emptyManifest(),
    now: new Date().toISOString(),
  };
}

function maxTime(a: string, b: string): string {
  return a >= b ? a : b;
}

function bookActivityTimestamp(book: SyncedBook): string {
  const positionTime = book.position?.updatedAt ?? "";
  return maxTime(positionTime, book.annotationsUpdatedAt);
}

/**
 * Newest position wins; ties break by the greater device id so both
 * merging orders pick the same winner.
 */
function mergePosition(
  local: ReadingPositionSync | null,
  remote: ReadingPositionSync | null,
): ReadingPositionSync | null {
  if (!local) return remote;
  if (!remote) return local;
  if (local.updatedAt > remote.updatedAt) return local;
  if (remote.updatedAt > local.updatedAt) return remote;
  return local.deviceId >= remote.deviceId ? local : remote;
}

function isTombstoneActive(tombstone: Tombstone, now: string): boolean {
  const deletedAt = Date.parse(tombstone.deletedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(deletedAt) || Number.isNaN(nowMs)) return true;
  return nowMs - deletedAt < TOMBSTONE_TTL_MS;
}

function activeTombstoneKey(
  tombstone: Tombstone,
  now: string,
): { bookId: string; annotationId: string } | null {
  if (tombstone.kind !== "annotation" || !tombstone.annotationId) return null;
  if (!isTombstoneActive(tombstone, now)) return null;
  return { bookId: tombstone.bookId, annotationId: tombstone.annotationId };
}

function isBookTombstoned(tombstones: Tombstone[], bookId: string, now: string): boolean {
  return tombstones.some(
    (tombstone) =>
      tombstone.kind === "book" && tombstone.bookId === bookId && isTombstoneActive(tombstone, now),
  );
}

function mergeByNewestTimestamp<T extends { id: string }>(
  local: T[],
  remote: T[],
  timestampOf: (item: T) => string,
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const item of local) merged.set(item.id, item);
  for (const item of remote) {
    const existing = merged.get(item.id);
    if (!existing || timestampOf(item) > timestampOf(existing)) {
      merged.set(item.id, item);
    }
  }
  return merged;
}

function filterTombstoned<T extends { id: string }>(
  items: Map<string, T>,
  bookId: string,
  tombstones: Tombstone[],
  now: string,
): Map<string, T> {
  const suppressed = new Set(
    tombstones
      .map((tombstone) => activeTombstoneKey(tombstone, now))
      .filter((key): key is { bookId: string; annotationId: string } => key !== null)
      .filter((key) => key.bookId === bookId)
      .map((key) => key.annotationId),
  );
  for (const id of suppressed) items.delete(id);
  return items;
}

function mergeAnnotations(
  local: AnnotationsFile,
  remote: AnnotationsFile,
  bookId: string,
  tombstones: Tombstone[],
  now: string,
): AnnotationsFile {
  const highlights = filterTombstoned(
    mergeByNewestTimestamp(local.highlights, remote.highlights, (item) => item.createdAt),
    bookId,
    tombstones,
    now,
  );
  const bookmarks = filterTombstoned(
    mergeByNewestTimestamp(local.bookmarks, remote.bookmarks, (item) => item.createdAt),
    bookId,
    tombstones,
    now,
  );
  return {
    schemaVersion: Math.max(local.schemaVersion ?? 1, remote.schemaVersion ?? 1),
    highlights: [...highlights.values()],
    bookmarks: [...bookmarks.values()],
  };
}

function mergeBooks(
  bookId: string,
  local: SyncedBook,
  remote: SyncedBook,
  tombstones: Tombstone[],
  now: string,
): SyncedBook {
  const localNewer = bookActivityTimestamp(local) >= bookActivityTimestamp(remote);
  const [newerMetadata, olderMetadata] = localNewer
    ? [local.metadata, remote.metadata]
    : [remote.metadata, local.metadata];
  return {
    metadata: { ...olderMetadata, ...newerMetadata },
    position: mergePosition(local.position, remote.position),
    annotations: mergeAnnotations(
      local.annotations,
      remote.annotations,
      bookId,
      tombstones,
      now,
    ),
    annotationsUpdatedAt: maxTime(local.annotationsUpdatedAt, remote.annotationsUpdatedAt),
    fileRevision: localNewer ? local.fileRevision ?? remote.fileRevision : remote.fileRevision ?? local.fileRevision,
    coverRevision: localNewer ? local.coverRevision ?? remote.coverRevision : remote.coverRevision ?? local.coverRevision,
  };
}

function mergeTombstones(
  local: Tombstone[],
  remote: Tombstone[],
  now: string,
): Tombstone[] {
  const byKey = new Map<string, Tombstone>();
  const keyOf = (tombstone: Tombstone) =>
    tombstone.kind === "book"
      ? `book:${tombstone.bookId}`
      : `annotation:${tombstone.bookId}:${tombstone.annotationId}`;
  for (const tombstone of [...local, ...remote]) {
    const key = keyOf(tombstone);
    const existing = byKey.get(key);
    if (!existing || tombstone.deletedAt > existing.deletedAt) {
      byKey.set(key, tombstone);
    }
  }
  return [...byKey.values()].filter((tombstone) => isTombstoneActive(tombstone, now));
}

function mergeEnvelope<T>(
  local: PreferenceEnvelope<T> | null,
  remote: PreferenceEnvelope<T> | null,
): PreferenceEnvelope<T> | null {
  if (!local) return remote;
  if (!remote) return local;
  if (local.updatedAt > remote.updatedAt) return local;
  if (remote.updatedAt > local.updatedAt) return remote;
  return local.deviceId >= remote.deviceId ? local : remote;
}

/**
 * Merge two Manifests into the converged state both devices should adopt.
 * The merge is commutative: mergeManifests(a, b) equals mergeManifests(b, a).
 */
export function mergeManifests(
  a: SyncManifest,
  b: SyncManifest,
  now: string,
): SyncManifest {
  const tombstones = mergeTombstones(a.tombstones ?? [], b.tombstones ?? [], now);

  const bookIds = new Set([...Object.keys(a.books ?? {}), ...Object.keys(b.books ?? {})]);
  const books: Record<string, SyncedBook> = {};
  for (const bookId of bookIds) {
    if (isBookTombstoned(tombstones, bookId, now)) continue;
    const local = a.books?.[bookId];
    const remote = b.books?.[bookId];
    if (local && remote) {
      books[bookId] = mergeBooks(bookId, local, remote, tombstones, now);
    } else {
      books[bookId] = (local ?? remote)!;
    }
  }

  return {
    schemaVersion: Math.max(a.schemaVersion ?? 1, b.schemaVersion ?? 1),
    books,
    tombstones,
    preferences: mergeEnvelope(a.preferences ?? null, b.preferences ?? null),
    provider: mergeEnvelope(a.provider ?? null, b.provider ?? null),
  };
}
