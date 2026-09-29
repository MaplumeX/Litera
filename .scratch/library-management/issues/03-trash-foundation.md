# 03: Trash foundation — descriptor, session staging, retention, restore/purge commands

**What to build:** The local trash becomes a first-class, recoverable store rather than a crash-recovery side channel. Deleting a book stages the book directory **and** its Sessions, plus a descriptor that carries the deleted `BookRecord` snapshot, so a restore can put the book back whole. The Rust layer exposes list/restore/permanently-delete commands for the UI (ticket 05) and sweeps entries older than the retention window.

**Blocked by:** none.

**Status:** ready-for-agent

- [x] New `TrashEntry` struct (serde camelCase) exposed to the frontend: `entryId`, `bookId` (empty for orphan staging), `title`, `author`, `coverPath` (empty when the entry has none), `deletedAt`, `origin` (`"local" | "sync"`), `sizeBytes`, `hasSessions`, `restorable`
- [x] On delete, a descriptor file `.trash/<bookId>-<operationId>.json` is written holding the full `BookRecord` snapshot plus `deletedAt` (RFC 3339, UTC), `origin`, and the staged Sessions directory name
- [x] Sessions are staged, not deleted: `remove_book_sessions` is replaced by `stage_book_sessions_to_trash`, which renames `sessions/<bookId>` to `.trash/<bookId>-<operationId>.sessions`; `sessions/<bookId>` is gone immediately (Sync must never see a deleted book's Sessions)
- [x] Both `delete_book` and `delete_book_for_sync` stage through the same path, recording `origin` accordingly; the Book Tombstone itself is still recorded by the `delete_book` command, keeping the store layer free of Sync concerns
- [x] Trash writes are crash-safe in the existing style: descriptor written via `atomic_write`, directory staged via `fs::rename` + `sync_parent_directory`, and every failure path rolls back (restores the staged directory / removes the descriptor)
- [x] `recover_staged_deletions` no longer matches `<bookId>-*.sessions` directories (today its prefix match would restore a staged Sessions directory as if it were the book directory), and it **skips entries that have a descriptor** — those belong to the Trash, not to crash recovery
- [x] A descriptor-less, Sessions-less staged directory (a genuine crash remnant for a book still listed in `library.json`) is still recovered exactly as today
- [x] `list_trashed_books` returns entries newest-first; descriptor-less remnants appear with a best-effort `deletedAt` from directory mtime and `origin: "local"`
- [x] `restore_trashed_book(entryId)` restores the book directory, the Sessions directory, and re-inserts the `BookRecord` into `library.json`, failing cleanly (no partial state) when `books/<bookId>` already exists or `library.json` already lists the id
- [x] Restore rewrites `filePath`/`coverPath` from the *current* app-data root rather than trusting the snapshot's absolute paths, and sets `cached: true`
- [x] Restore removes the descriptor only after `library.json` is committed
- [x] Restore revokes the local Book Tombstone (new `sync::remove_book_tombstone(root, book_id)`, mirroring `record_book_tombstone`), so a later Sync does not immediately delete the restored book again
- [x] Entries recorded with `origin: "sync"` are listed but never restorable: the command rejects them and `restorable` is false in the listing
- [x] `purge_trashed_book(entryId)` permanently removes the book directory, the Sessions directory, and the descriptor; `purge_all_trashed_books` does so for every entry
- [x] Retention: `TRASH_TTL_SECS` (30 days, matching `TOMBSTONE_TTL_SECS`) and a sweeper that removes expired entries (book dir + Sessions dir + descriptor); it runs at startup after every recovery pass, and a single unreadable entry is logged and skipped rather than failing startup
- [x] `trash_paths_for_stem` verifies all three payload paths resolve as direct children of `books/.trash` before touching them (same guard style as `book_dir`), so a crafted id cannot escape the trash root
- [x] All four commands registered in `src-tauri/src/lib.rs`
- [x] Restore validates the descriptor against its entry id (`book_id_of_stem(entry_id) == record.id`) and rejects a mismatch as corrupt

## Comments

- Descriptor naming keeps the existing `<bookId>-<operationId>` stem so a descriptor and its payload can be paired without a separate index; `.json` and `.sessions` are distinguishable by extension and `is_dir()`.
- Parse the directory name for pairing only. `operationId()` (`library.rs`) embeds `%Y%m%d%H%M%S%f` plus a hex counter, so its trailing counter makes round-trip parsing fragile — timestamps come from the descriptor.
- `delete_book_for_sync` intentionally also stages (a remote Tombstone means the local copy is no longer wanted), but ticket 05 only offers Restore for `origin: "local"`.
- Rust unit tests (inline, prior art `library.rs` / `sync::tombstone_tests`): delete → list → restore round-trips an identical `BookRecord` and Sessions; restore refuses an occupied id; descriptor-less remnant recovered while a descriptor-bearing entry is not; `.sessions` entries never treated as book dirs; sweeper removes only expired entries; restore revokes the Tombstone.

- Implemented with an entry id (the staged name stem) as the address for restore/purge, instead of `(bookId, operationId)`: the stem already names all three payloads, and orphan staging (`.trash/orphan-<name>-<op>`) has no bookId to pass back. `TrashEntry.entryId` carries it.
- **Checklist correction (the original ask was wrong):** the ticket said to remove the descriptor if the Book Tombstone write fails, "so the operation is not left half-done". That would turn a recoverable deletion into an unrecoverable orphan — strictly worse than a missing tombstone, which only delays propagation to other devices. The store layer now never touches Sync; the `delete_book` command records the tombstone after the store commit, exactly as before.
- Two behaviours were tightened beyond the original checklist:
  - `restorable` is `record.is_some() && origin == "local"`, and `restore_trashed_book` independently rejects `origin: "sync"`. A book deleted by a remote Tombstone would be deleted again by the next Sync, so Restore would be a lie.
  - Restore cross-checks the descriptor against its entry id (`book_id_of_stem(entry_id) == record.id`) and treats a mismatch as corrupt.
- The sweeper logs and skips an individual unreadable entry rather than failing startup, per the retention requirement; `recover_staged_deletions` and `stage_orphaned_book_directories` keep their strict behaviour because they decide where a referenced book lives.
- Discovered while testing: `LibraryStore::read_library` runs `validate_library_files`, so **any** Library read fails if a record's directory is missing. Tests that simulate a crash remnant must therefore stage the directory *after* the last Library call, which is why the tests order their steps the way they do.
- Existing test updated: `sync::tombstone_tests::apply_moves_a_tombstoned_book_into_the_local_trash` asserted "exactly one entry in the trash", which now also contains the descriptor; it filters to directories.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 240 passed. `cargo fmt --check` reports pre-existing diffs across the repository baseline (`sync.rs`, `agent_config.rs`, `pi_sessions.rs` were already non-clean), so no repository-wide reformat was performed.

## Comments (review fixes)

- **Restore dropped the cover of a PNG-cover book.** Both the listing and `restore_trashed_book` hardcoded `cover.jpg` while the store's own contract accepts `cover.jpg` or `cover.png`, so a legacy record came back with `coverPath: ""` — the file on disk but unreferenced. Both sites now go through one `staged_cover_name` helper, with a regression test.
- **One unreadable descriptor hid the whole Trash.** `list_trashed_entries` propagated the parse error, which `refreshTrash` swallowed with `console.error`, so the entry point silently disappeared. It now logs and skips the bad entry; the readable ones still list.
- **Dead field removed:** `TrashDescriptor.sessions_name` was written and never read (paths are derived from the stem). Replaced by `TrashDescriptor.size_bytes`, which the spec asked for and which backs the listing when the payloads can no longer be walked.
- **Baseline smells cleaned up:** the `read_dir` + `trash_stem_of` stem-set loop was duplicated between `list_trashed_entries` and `purge_expired_trash` — both now call one `trash_stems` helper — and the `(PathBuf, PathBuf, PathBuf)` clump became a `TrashEntryPaths` struct resolved by one `trash_entry_paths` function.
- `TrashDescriptor.origin` and `TrashEntry.origin` are now a `TrashOrigin` enum instead of a string compared against literals; `TrashEntry`'s empty-string sentinels (`bookId`, `coverPath`, `deletedAt`) became `Option`, so "absent" crosses the IPC boundary as `null` rather than `""`.
- An orphan staged at startup no longer leaks a raw stem as its title: the title is empty and the UI labels it (未命名条目 / "Unnamed entry").
