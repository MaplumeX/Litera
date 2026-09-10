# 03: First sync — Manifest push/pull with reading positions and book metadata convergence

**What to build:** The tracer bullet for the whole sync loop. With Sync enabled, the manual "Sync now" button executes a complete round trip: GET the remote Manifest, merge it with local state via the merge engine, upload the merged Manifest with a conditional PUT (`If-Match` on the current etag), retrying a bounded number of times on etag mismatch by re-fetching and re-merging, and apply the merged result locally. Book metadata (title, author, cover pointer) and reading positions converge across devices. A device with an empty local Library downloads the Manifest and renders the shelf from it (books whose files aren't local yet are simply not openable — file sync is ticket 05). Verifiable: two machines, each having read different books or the same book to different pages, both show converged metadata and the newest reading position after each clicks "Sync now".

**Blocked by:** 01 (Sync configuration and connection test), 02 (Merge engine).

**Status:** ready-for-agent

- [ ] "Sync now" performs GET remote Manifest → merge → conditional PUT with `If-Match`, bounded retry on etag mismatch
- [ ] Book metadata converges across devices after a manual sync on each
- [ ] Reading positions converge to the newest `updated_at` (tie-break by device id)
- [ ] An empty-device first sync downloads the Manifest and renders the shelf immediately
- [ ] Conflict between two simultaneous syncs loses neither side's data (merge retry path)
- [ ] Sync errors are reported in the Settings sync status area (toast cadence is ticket 08)
- [ ] Rust-side Manifest serialization round-trip and etag retry loop covered by inline unit tests
- [ ] Manifest is a single object; book files/covers are separate objects referenced by revision (upload of files themselves is ticket 05)
