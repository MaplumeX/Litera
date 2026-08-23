# Database Guidelines

> Persistence patterns for the Litera backend. This project has **no traditional database** — persistence is file-based (JSON/JSONL), while book search is rebuilt in a browser worker.

---

## Overview

Litera uses two distinct persistence mechanisms, neither of which is a relational database:

1. **Library storage** — `library.json` in the Tauri app data directory. Rust reads/writes it directly via `serde_json`. No ORM, no migrations, no query builder.
2. **Preferences storage** — `preferences.json` next to `library.json`. Theme plus typography defaults. Same atomic write helper; separate `PreferencesStore` gate. See `tauri-commands.md` Preferences Commands.
3. **Session storage** — Pi v3 JSONL session files managed by Rust under `<app_data>/sessions/<bookId>/`.
4. **Book search** — an in-memory index in the browser EPUB worker, rebuilt on each book open and never persisted.

Reference files:
- `src-tauri/src/library.rs` — `LibraryStore`, strict reads, atomic writes, recovery transactions
- `src-tauri/src/pi_sessions.rs` — Pi v3 session validation, migration, append, and deletion
- `src/agent/book/` — EPUB extraction, chapter ownership, and browser-worker search

### Pi v3 session store

The embedded runtime uses `src-tauri/src/pi_sessions.rs` against the
`<app_data>/sessions/<bookId>/` directory. It preserves Pi session v3 JSONL as
an append-only tree. Normal v3 interaction never rewrites history; v1/v2 loads
create a `.pre-v3.bak` before atomically applying Pi's published migrations.

Rust validates paths, real files/directories, header version, timestamps,
ids/parents, byte caps, and expected leaves. The frontend owns message payload
decoding and branch projection.

A non-empty final JSON value without its newline terminator is still a complete
entry: append recovery adds the missing newline and preserves it. Only an
unparseable final fragment may be truncated, and all preceding lines must first
remain valid. Header-only lookup must not parse or silently discard corrupt
later rows; loading the identified file reports `StorageCorrupt`.

---

## Library Storage (library.json)

### Pattern: read-modify-write the entire file

Every library mutation acquires the shared `LibraryStore` gate, strictly reads the full versioned `library.json`, modifies the `books` vector, and atomically replaces the entire file. There is no incremental update and no independent read-modify-write snapshot outside the gate.

```rust
fn update_reading_state(&self, book_id: &str, fraction: Option<f64>, settings: Option<ReadingSettings>, last_reader_mode: Option<String>, last_layout: Option<ReaderLayout>, last_cfi: Option<String>) -> AppResult<()> {
    let _guard = self.transaction()?;
    let mut library = self.read_library()?;
    let record = library.books.iter_mut()
        .find(|book| book.id == book_id)
        .ok_or_else(|| AppError::book_not_found(book_id))?;
    // last_fraction, settings, last_reader_mode, last_layout, and last_cfi are independent Options.
    // settings / last_layout, when present, REPLACE the whole object — they do not merge keys.
    self.write_library(&library)
}
```

### Conventions

- **`schemaVersion: 1` is mandatory**. Legacy unversioned storage is moved to `backup/legacy-<timestamp>/` before a new empty store is created.
- **Strict reads**: missing files, malformed JSON, unknown/missing fields, duplicate IDs, invalid settings, unsafe stored paths, missing files, and symlinks are errors. Never use `unwrap_or(empty)`.
- **Recoverable atomic write**: same-directory tempfile → write → flush → file `sync_all` → atomic persist → parent-directory sync. If failure occurs after persist, restore the prior complete bytes.
- **All filesystem work is blocking work**: every Tauri library command is async and delegates store operations to `spawn_blocking`.
- **Partial updates merge under the gate** so concurrent fraction/settings/mode/layout/cfi calls cannot overwrite one another. `last_fraction`, `settings`, `last_reader_mode`, `last_layout`, and `last_cfi` are independent Options. At least one must be `Some`. When `settings` is `Some`, the **entire** `ReadingSettings` object is replaced. When `last_layout` is `Some`, the **entire** `ReaderLayout` snapshot is replaced. `last_cfi` is a locator string (`validate_cfi`), not a nested object. Frontend must send the full intended snapshot of overrides still in effect. `fontSize` / `fontFamily` are optional like the other keys. Restore-default = omit that key from the snapshot. Sending `{ lineHeight }` alone drops every other override. Do not store reader/agent mode, chrome layout, or the CFI locator on `ReadingSettings`.
- **Optional shelf fields**: `lastOpenedAt` (RFC3339), `contentHash` (64 lowercase hex SHA-256 of the committed EPUB), `lastReaderMode` (`"reader"` | `"agent"`), `lastLayout` (`{ chatCollapsed, bookCollapsed, sessionRailOpen }` bools), and `lastCfi` (`epubcfi(...)`, same `validate_cfi` as bookmarks, max 8 KiB). All use `#[serde(default)]`. Missing is valid. Present-but-invalid is `StorageCorrupt`. Do not bump `schemaVersion` for these fields. App-wide default mode is **not** a shelf field — it lives in `localStorage` (`litera.defaultReaderMode`); see frontend `i18n.md` / `component-guidelines.md`. Library sort/view (`litera.librarySort` / `litera.libraryView`) are the same class of frontend-only prefs. Pane widths stay in `localStorage`; TOC/annotation drawers stay process-only. `lastFraction` is percent for cards/scrubber; reopen uses `lastCfi` (see backend `tauri-commands.md` "Scenario: lastCfi"). Post-import title/author/cover edits use `update_book_metadata`, not `save_book_metadata`, and must not rewrite the EPUB (see backend `tauri-commands.md` "Scenario: update book metadata after import").
- **Optional typography overrides** on `ReadingSettings`: `fontSize`, `fontFamily`, `lineHeight`, `contentWidth`, `pagePadding`, `textAlign`, `letterSpacing`, `paragraphSpacing`, `firstLineIndent`, `overrideFont`, `overrideLayout`. Leftover `pageMargin` is read-only for old records. Same rule — optional, no `schemaVersion` bump. Effective value is book override ?? `preferences.json` ?? builtin. Theme stays global-only. New writes never emit `pageMargin`. `fontFamily` is a validated string (`is_valid_font_family`), not a three-value enum. A named face that fails the old enum check must still load. `overrideFont` / `overrideLayout` are `Option<bool>`: omit = follow global; `false` is a real per-book override (global on, this book off). Snapshot serialization must keep `false`. Builtin default is `false`. See backend `tauri-commands.md` "Scenario: override publisher font and layout".
- **`preferences.json` schemaVersion stays 1**. New keys must `serde(default)`. A valid theme-only file must load without rewrite. `save_preferences` is read-modify-write; never reconstruct the file from theme alone. Dual-read old `lineHeight` / `pageMargin` enums; persist numbers + `contentWidth` / `pagePadding`.

### Storage Layout

```
<app_data>/
├── library.json              # { "schemaVersion": 1, "books": [...] }
├── books/<bookId>/
│   ├── book.epub             # active canonical epub
│   ├── cover.png             # optional active cover
│   ├── annotations.json      # optional bookmarks + highlights; not a BookRecord field
│   ├── .imports/             # exact bytes awaiting metadata commit
│   └── .transactions/        # persistent rollback journals
├── books/.trash/             # staged/committed recoverable deletions
├── backup/legacy-*/          # recoverable legacy artifacts
└── sessions/<bookId>/        # Rust-managed Pi v3 JSONL session files
```

**Per-book annotations**: `books/<bookId>/annotations.json` holds bookmarks and highlights (closed color ids + optional notes). It has its own `schemaVersion: 1` and is **not** part of `library.json` / `BookRecord`. Do not bump the library schema — or this file's schema — for optional `color` / `note`. Missing file = empty lists. Present but invalid JSON / unsupported schema / unknown fields / unknown `color` = `StorageCorrupt`. Overwrite leaves the file in place; `delete_book` removes the whole directory. Do not require this file in `validate_library_files`. See backend `tauri-commands.md` "Scenario: highlight color and note".

### bookId Generation

`bookId` is a `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record.

Content identity is `contentHash`, not `bookId`. After backfill, any existing `contentHash` that equals the incoming SHA-256 is `duplicate` — including the same-path record. Same-path unchanged does not stage and does not rewrite `library.json`. Same-path with a **different** hash still stages under a unique `importId` and commits through the recovery protocol in `tauri-commands.md`.

Books missing a hash are hashed from the stored EPUB on the next open (`get_book_open_context`) or the next import classification — not at startup. Classify only after that backfill, or a hash-less same-path reopen looks like `overwrite`.

`list_books` sorts by `lastOpenedAt` descending (unset last), then `importedAt` descending.

```rust
let book_id = {
    let path_str = src_path.to_string_lossy();
    let mut hasher = DefaultHasher::new();
    path_str.hash(&mut hasher);
    format!("{:x}", hasher.finish())
};
```

### Don't: use a real ORM or migration framework

This project deliberately uses a simple JSON file for library data. Do not introduce SQLite, Diesel, or SeaORM for the library store — it would add complexity for a dataset that is a single small JSON file.

---

## Browser Book Search

The EPUB worker extracts TOC-owned chapter text and serves deterministic exact
and partial searches. Results retain the owned chapter index, href, and honest
part offset used by reader navigation. The index lives only in worker memory;
opening another book or terminating the worker discards it.

Do not persist a duplicate search database. EPUB bytes remain the source of
truth, and rebuilding keeps search aligned with the exact open content version.

---

## Pi Session Storage

- Sessions are scoped to `<app_data>/sessions/<bookId>/<sessionId>.jsonl`.
- Rust validates identifiers, containment, symlinks, file types, sizes, Pi v3
  headers, timestamps, entry ids, and parent links before returning content.
- Appends are optimistic: callers provide the expected leaf id and stale writers
  fail instead of silently forking or overwriting history.
- Pi v1/v2 migration creates a `.pre-v3.bak` before atomically replacing the
  source. Normal v3 use is append-only.
- Deleting a book also deletes its session directory. A missing directory is
  success; a post-commit removal failure is `StorageIo` and does not restore the
  deleted library record.

---

## Common Mistakes

### Using content hash as bookId

**Wrong**: replace path-hash `bookId` with SHA-256 of bytes so duplicates share an id.

**Correct**: keep path-hash `bookId` (sessions, trash, `contentVersion` stay stable). Store SHA-256 as `contentHash`. Same hash (any path, including self) is `duplicate`; same path + different hash is `overwrite`; otherwise `new`.

### Hashing the wrong path for bookId

**Wrong**: hashing the app data copy path (`dest_path`) — it's stable per bookId but changes if the library is rebuilt, and two different source files could theoretically collide.

**Correct**: hash the **source file path** before staging. See `import_book` in `src-tauri/src/library.rs`.

### Treating missing or corrupt library.json as an empty library

**Wrong**: `read_library().unwrap_or(LibraryData::empty())` after initialization.

**Correct**: initialization alone creates the first empty versioned file. Runtime reads propagate `StorageIo` / `StorageCorrupt` so existing data is never overwritten by an empty fallback.

### Writing library.json without creating the directory first

Initialization creates and validates real (non-symlink) storage directories. Any new internal path must be derived from the trusted root, validate its identifier, verify its direct parent, and use the atomic writer.
