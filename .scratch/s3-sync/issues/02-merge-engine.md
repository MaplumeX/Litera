# 02: Merge engine (pure TS core)

**What to build:** The Manifest model and all merge semantics as pure functions in the frontend lib layer, completely unaware of S3 and Tauri: reading positions take the newest `updated_at` (ties broken by device id, timestamps are explicit recorded fields never file mtime), Annotations merge by id union, single-annotation and whole-book deletions propagate via Tombstones that expire after 30 days, diverged Sessions keep both branches, app/provider preferences merge deterministically, and an empty local Library joining an existing Manifest downloads instead of uploading (bootstrap direction decided by manifest state comparison). Verifiable on its own: the vitest suite passes against behavior-level assertions (round-trips, union outcomes, tombstone expiry, tie-breaks, branch preservation).

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Manifest model covers book metadata, per-book reading positions, Annotations, Tombstones, and per-item timestamps with device ids
- [ ] Reading position merge: newest `updated_at` wins, ties broken by device id, no reliance on file mtime
- [ ] Annotations merge: union by annotation id; a Tombstoned id wins over a live id until the Tombstone expires (30 days)
- [ ] Whole-book deletion propagates via a Tombstone; a device learning of it treats the book as deleted
- [ ] Diverged Sessions both survive a merge (both branches kept)
- [ ] Empty-device bootstrap: an empty local Library pulls from the Manifest rather than clobbering it
- [ ] All logic is pure (no network, no Tauri invoke, no filesystem)
- [ ] Tests assert external behavior only, colocated following the existing lib-layer test pattern
