# 04: Annotations sync and tombstone propagation

**What to build:** A reader's Annotations (bookmarks, highlights with colors, notes) follow them across devices: after a sync, highlights created on device A appear on B, and vice versa, with the union preserving both sides. Deleting a single highlight propagates so it is not resurrected by a later merge. Deleting a whole book on one device propagates via its Tombstone: the other device moves the book into its local trash, and the Sync Backend object set is cleaned up after the 30-day retention window (any device may opportunistically purge expired Tombstones). Verifiable: highlight on one machine, sync both, see it on the other; delete a highlight or a book, sync, and the deletion holds everywhere.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [x] Annotations created on one device appear on the other after sync (union by id)
- [x] A single deleted highlight stays deleted on the other device after sync (per-item Tombstone beats union-resurrection)
- [x] A deleted book propagates: other devices move it into their local trash (local trash never itself syncs)
- [x] Tombstones expire after 30 days and can be purged opportunistically by any syncing device
- [x] Annotation merge outcomes covered by merge-engine tests; sync wiring covered by app-level tests

## Comments

- Implemented: `save_annotations` records per-annotation Tombstones for removed ids and bumps `annotationsUpdatedAt` in sync-state.json; `delete_book` records a book Tombstone. `apply_merged_manifest` moves tombstoned books into the local trash (`LibraryStore::delete_book_for_sync`, placeholders included), writes merged annotations for known books, and guards against clobbering local edits made mid-sync by comparing against the pre-merge base snapshot passed from the TS runner. Expired Tombstones are purged opportunistically on record and on merge. Local trash never syncs.
- App-level wiring (delete_book / save_annotations invokes) is covered by existing LibraryView tests; the tombstone recording lives in the Rust command layer and is covered by inline unit tests (`sync::tombstone_tests`).

## Comments (post-review)

- Review fix: `sync_apply_merged_manifest` now unions tombstones by key (newest `deletedAt` wins) instead of overwriting local state, so deletions recorded while the network round trip was in flight survive; `annotationsUpdatedAt` merges per-book with max(). Expired book Tombstones stay in local state until their objects are purged (sync_sessions), then drop out.
