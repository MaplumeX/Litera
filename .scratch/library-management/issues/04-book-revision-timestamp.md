# 04: Book revision timestamp and Tombstone revival in the merge engine

**What to build:** The Manifest gains a Book-level revision timestamp so metadata edits have a comparable time of their own, and the merge engine learns that a Book newer than its Tombstone is a revival rather than a deletion. This is what makes "Restore, then Sync" actually hold, and it is the prerequisite for syncing reading status and star (ticket 06).

**Blocked by:** none.

**Status:** ready-for-agent

- [x] `BookRecord` (`src-tauri/src/library.rs` + `src/types/library.ts`) gains `updatedAt?: string` (RFC 3339), `#[serde(default, skip_serializing_if = "Option::is_none")]`, bumped by `update_book_metadata` and by Restore (ticket 03); it is **not** bumped by reading-position or annotation writes
- [x] `SyncedBookData` (`src-tauri/src/sync.rs`) gains `book_updated_at: String` (`bookUpdatedAt`, `#[serde(default)]`), populated by `export_local_manifest` from `BookRecord::updated_at`, falling back to the existing "last opened" derivation when absent
- [x] `SyncedBook` (`src/lib/sync-merge.ts`) gains the same field; `bookActivityTimestamp` is kept as the **fallback** for manifests that predate it
- [x] `mergeBooks` chooses the newer side for `metadata` by `bookUpdatedAt` (fallback to `bookActivityTimestamp`), not by reading position; the merged book carries `max(local, remote)` of the two timestamps
- [x] Revival: a book is only dropped when an active Tombstone's `deletedAt` is **newer than** the book's `bookUpdatedAt`; otherwise the book survives and its Book Tombstone is discarded from the merged Tombstone set
- [x] Rust deliberately does **not** re-implement the revival rule: `apply_merged_manifest` executes the TS-produced manifest, and TS removes revived Tombstones before Rust sees them, so the policy has one implementation instead of two that could drift
- [x] Missing-timestamp compatibility: a Manifest with no `bookUpdatedAt` merges exactly as today (position/annotation time compared, Tombstone unconditionally wins) so upgrading mid-sync cannot resurrect a genuinely deleted book
- [x] `mergeManifests(a, b)` remains commutative for both the metadata-winner and the revival outcome
- [x] Cases added to `src/lib/sync-merge.test.ts`: newer `bookUpdatedAt` wins metadata; a metadata edit beats a *newer reading position* on the other side (the behaviour change this ticket exists for); revival newer than a Tombstone keeps the book and drops the Tombstone; Tombstone newer than the book stays deleted; legacy manifest without the field keeps today's outcome; both directions of each case for commutativity
- [x] Rust-side tests: `export_local_manifest` emits `bookUpdatedAt`; apply honours revival and matches the TS outcome for the same fixture
- [x] `docs/adr/0001-s3-sync.md` updated with the revival rule and the `bookUpdatedAt` field, since it changes documented merge semantics

## Comments

- **Scope boundary:** metadata is still merged as one object (`{ ...older, ...newer }`) behind a single timestamp, so concurrent edits to *different* metadata fields on two devices still resolve last-writer-wins. Per-field envelopes are deliberately out of scope (see the spec). The fix this ticket buys is that the comparison time is now honest — today `update_book_metadata` records no timestamp at all and metadata is compared against `annotationsUpdatedAt`/position time, so a metadata edit can silently lose to unrelated reading activity.
- A **downgrade** (older Litera reading a newer Manifest) ignores `bookUpdatedAt` and may drop it on its next upload. Recorded as a known limitation, not solved here.
- Touching `BookRecord` requires checking `SCHEMA_VERSION` handling in `library.rs`: the field is optional with a default, so no schema bump is needed.

- Implemented as a `BookRecord::updated_at` (`updatedAt`) rather than a per-book entry in `sync-state.json`, so the revision travels with the record itself (export, restore, and the store layer all see it without a second lookup). It is bumped by `update_book_metadata` and by `restore_trashed_book` (the latter is what makes Restore look newer than the Tombstone its own deletion wrote).
- `export_local_manifest` exports **only** an explicit `updated_at`; it deliberately does not fall back to `last_opened_at`. An earlier revision of this work did fall back, which made `bookRevision` skip its `bookActivityTimestamp` fallback and silently changed metadata ordering for books that predate the field — the exact regression ADR 0001 promises not to cause. Caught in review; the fallback was removed and the ADR statement now matches the code.
- `apply_merged_manifest` writes the merged `bookUpdatedAt` back onto the record, so the next export is consistent with what the merge decided.
- `mergeBooks` carries `bookUpdatedAt` forward only when at least one side has an explicit value (`maxTime(local ?? "", remote ?? "")`); an all-old manifest therefore keeps falling back to activity on later merges instead of freezing reading activity as an edit time.
- Revival lives in `mergeManifests`: a book named by an active Tombstone survives when `bookRevision(book) > tombstone.deletedAt`, and that Tombstone is filtered out of the merged set. `bookRevision` prefers `bookUpdatedAt` and falls back to `bookActivityTimestamp`, so pre-existing data is unaffected.
- Rust keeps owning only storage/transport (`apply_merged_manifest` executes the TS-produced manifest); the revival decision itself is TS-only, which is why the Rust tests assert the timestamp round trip rather than the policy.
- `docs/adr/0001-s3-sync.md` updated with both rules.
- Tests: 5 TS merge cases in `src/lib/sync-merge.test.ts` (revision ordering beating a newer position, the no-field fallback, revival, non-revival, and revival commutativity) plus Rust cases for the metadata bump, the restore bump, the export field, and the apply round trip.
- `cargo test`: 243 passed. Full frontend suite: 802 passed; `tsc --noEmit` clean.
