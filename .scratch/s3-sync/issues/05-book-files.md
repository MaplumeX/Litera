# 05: EPUB and cover upload with on-demand download

**What to build:** The large-object half of Sync. When Sync is first enabled on a device that already has books, an upload-size estimate is shown and the bulk upload only starts after confirmation. New imports thereafter upload automatically, using multipart upload with resume so large books survive flaky connections. On a new device, the shelf renders instantly from the Manifest; covers and EPUB files download on demand (cover when displayed, book file when opened) and are cached locally. Book cards clearly show a "not cached" state for books whose file isn't local, and opening such a book downloads it first. Verifiable: enable Sync on a full library, confirm the estimate, see books appear on a fresh machine, open one and read it.

**Blocked by:** 03 (First sync — Manifest push/pull).

**Status:** ready-for-agent

- [x] First-enable flow shows an upload-size estimate before bulk-uploading the existing library; upload starts only after confirmation
- [x] New imports upload automatically after Sync is enabled
- [x] Book uploads use multipart with resume for large files
- [x] New device: shelf and reading positions render immediately from the Manifest without waiting for files
- [x] Covers download on demand when displayed; EPUB files download on demand when a book is opened
- [x] Downloaded books are cached locally and re-openable offline
- [x] Book cards show a "not cached" state for books whose file isn't local, with localized copy
- [x] App-level tests cover the "not cached" card state and the estimate confirmation flow

## Comments

- Object layout: `litera/files/<bookId>/<revision>/book.epub` and `.../cover.jpg`, revision = content hash, referenced from the Manifest (`fileRevision`/`coverRevision`), recorded locally in sync-state `book_revisions`.
- "Multipart with resume": EPUBs upload via object_store multipart in fixed 8 MiB parts with bounded whole-upload retries (object_store exposes no cross-process part resume; retries keep a flaky connection eventually converging, and revision-addressed keys make re-uploads idempotent).
- First-enable flow: `sync_estimate_upload` → estimate panel in Settings → `sync_confirm_bulk_upload` (persisted flag) → `runSyncOnce({uploadFiles:true})`. After confirmation new imports upload automatically.
- On-demand download: `sync_download_book_file` is invoked before every open (no-op for cached books); `sync_ensure_cover` is invoked by the shelf for visible uncached books. `list_books` now merges placeholders (`cached: false`), so the shelf renders instantly from the Manifest; covers/EPUBs cache locally under `books/<id>/`.
- Expired Tombstones release their Sync Backend objects (opportunistic prefix purge during the session phase of a sync pass).
- Tests: Rust (`file_sync_tests`, placeholder promotion, estimate, purge selection, key layout), app-level (BookCard not-cached badge in grid+list, LibraryView cover-on-demand, App open-uncached-book download order, SyncSettingsForm estimate confirmation).

## Comments (post-review)

- Review fix: `BookRecord.cached` uses `#[serde(default = "default_true", skip_serializing_if = ...)]` so it actually crosses IPC for placeholders (the previous `#[serde(skip)]` made the "not downloaded" badge and cover-on-demand dead code) without being persisted into library.json.
- Review fix: a cover-only edit counts as pending (the stored cover's hash is compared against the recorded revision); the EPUB PUT is skipped when its revision is unchanged.
- Review fix: expired-Tombstone purge moved into `sync_sessions` (always the last step of a pass) and now also removes purged Tombstones from local state; no early return skips it.
- Deviation (documented): true cross-process multipart resume is not exposed by `object_store`; uploads use fixed 8 MiB parts with bounded whole-upload retries and revision-addressed (idempotent) keys.
