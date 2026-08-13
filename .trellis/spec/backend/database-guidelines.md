# Database Guidelines

> Persistence patterns for the Litera backend. This project has **no traditional database** — persistence is file-based (JSON/JSONL) and full-text search uses an in-memory SQLite FTS5 index.

---

## Overview

Litera uses two distinct persistence mechanisms, neither of which is a relational database:

1. **Library storage** — `library.json` in the Tauri app data directory. Rust reads/writes it directly via `serde_json`. No ORM, no migrations, no query builder.
2. **Session storage** — JSONL session files managed by the sidecar's `SessionManager` (from `@earendil-works/pi-coding-agent`), under `<app_data>/sessions/<bookId>/`.
3. **Full-text search** — In-memory SQLite FTS5 (WASM via `fts5-sql-bundle`), rebuilt on each book open. Not persisted to disk.

Reference files:
- `src-tauri/src/library.rs` — `LibraryStore`, strict reads, atomic writes, recovery transactions
- `sidecar/book.ts` — `loadBook()`, FTS5 index construction
- `sidecar/index.ts` — `SessionManager` usage

---

## Library Storage (library.json)

### Pattern: read-modify-write the entire file

Every library mutation acquires the shared `LibraryStore` gate, strictly reads the full versioned `library.json`, modifies the `books` vector, and atomically replaces the entire file. There is no incremental update and no independent read-modify-write snapshot outside the gate.

```rust
fn update_reading_state(&self, book_id: &str, fraction: Option<f64>, settings: Option<ReadingSettings>) -> AppResult<()> {
    let _guard = self.transaction()?;
    let mut library = self.read_library()?;
    let record = library.books.iter_mut()
        .find(|book| book.id == book_id)
        .ok_or_else(|| AppError::book_not_found(book_id))?;
    // validate + merge only supplied fields
    self.write_library(&library)
}
```

### Conventions

- **`schemaVersion: 1` is mandatory**. Legacy unversioned storage is moved to `backup/legacy-<timestamp>/` before a new empty store is created.
- **Strict reads**: missing files, malformed JSON, unknown/missing fields, duplicate IDs, invalid settings, unsafe stored paths, missing files, and symlinks are errors. Never use `unwrap_or(empty)`.
- **Recoverable atomic write**: same-directory tempfile → write → flush → file `sync_all` → atomic persist → parent-directory sync. If failure occurs after persist, restore the prior complete bytes.
- **All filesystem work is blocking work**: every Tauri library command is async and delegates store operations to `spawn_blocking`.
- **Partial updates merge under the gate** so concurrent fraction/settings calls cannot overwrite one another.
- **Optional shelf fields**: `lastOpenedAt` (RFC3339) and `contentHash` (64 lowercase hex SHA-256 of the committed EPUB). Both use `#[serde(default)]`. Missing is valid. Present-but-invalid is `StorageCorrupt`. Do not bump `schemaVersion` for these fields.

### Storage Layout

```
<app_data>/
├── library.json              # { "schemaVersion": 1, "books": [...] }
├── books/<bookId>/
│   ├── book.epub             # active canonical epub
│   ├── cover.png             # optional active cover
│   ├── .imports/             # exact bytes awaiting metadata commit
│   └── .transactions/        # persistent rollback journals
├── books/.trash/             # staged/committed recoverable deletions
├── backup/legacy-*/          # recoverable legacy artifacts
└── sessions/<bookId>/        # sidecar-managed JSONL session files
```

### bookId Generation

`bookId` is a `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record. Re-import is not a no-op: it stages exact bytes under a unique `importId`, then commits EPUB + extracted metadata/cover through the recovery protocol described in `tauri-commands.md`.

Content identity is `contentHash`, not `bookId`. Duplicate detection compares SHA-256 of incoming bytes to existing `contentHash` values. Books missing a hash are hashed from the stored EPUB on the next open (`get_book_open_context`) or the next import classification — not at startup.

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

This project deliberately uses a simple JSON file for library data. Do not introduce SQLite, Diesel, or SeaORM for the library store — it would add complexity for a dataset that is a single small JSON file. The in-memory FTS5 database in the sidecar is the only SQLite usage, and it is ephemeral.

---

## Full-Text Search (In-Memory SQLite FTS5)

### Pattern: rebuild FTS5 index on each book open

The sidecar builds an in-memory SQLite FTS5 virtual table every time a book is opened. It is not persisted — closing the app or opening a new book discards it.

```typescript
// sidecar/book.ts
const db = new sqlStatic.Database();
db.run("CREATE VIRTUAL TABLE chapters USING fts5(content, tokenize='trigram')");
for (const [index, text] of chapterTexts) {
    db.run("INSERT INTO chapters (rowid, content) VALUES (?, ?)", [index + 1, text]);
}
```

### Conventions

- **Trigram tokenizer**: `tokenize='trigram'` — queries of 3+ characters work best.
- **rowid = chapter index + 1**: FTS5 rowid is 1-based; chapter indices are 0-based. Convert on read: `chapterIndex: row.rowid - 1`.
- **FTS is a candidate finder, not the excerpt source**: `searchInBook(queries)` runs exact `indexOf` first. When a query has no exact hit, `MATCH` an escaped quoted phrase (`escapeFtsPhrase`) to collect chapter rowids, then token-AND fallback. Snippets come from `snippetAround` (160-char radius) so `part = floor(offset / 12000)` is honest. Do not restore `snippet(chapters, …)` — it has no usable chapter offset.
- **Close previous DB on book reload**: `if (currentBook?.fts) currentBook.fts.close()` before resetting state.

### Don't: persist the FTS5 index to disk

The FTS5 index is intentionally ephemeral. EPUBs are small enough that rebuilding is fast. Do not add disk persistence for the search index.

---

## Session Storage (Sidecar JSONL)

### Pattern: SessionManager from pi-coding-agent

Session files are JSONL and managed by `SessionManager` from `@earendil-works/pi-coding-agent`. The sidecar does not implement session storage itself — it delegates to the SDK.

```typescript
// sidecar/index.ts
const sessionManager = SessionManager.create(process.cwd(), sessionDir, { id: sessionId });
const { session: s } = await createAgentSession({ sessionManager, customTools, resourceLoader });
```

### Conventions

- **Sessions scoped per book**: `<sessionsDir>/<bookId>/<sessionId>.jsonl`.
- **`sessionsDir` passed from Rust**: `notify_sidecar_book_opened()` sends the Tauri app data dir + `/sessions` as `sessionsDir`.
- **Lazy load from disk**: `loadSessionFromDisk()` reads a session JSONL when a `switch_session` request arrives for a session not in memory.
- **Best-effort deletion**: `unlink(managed.filePath)` — ignore errors if the file is already gone.
- **Deleting a book deletes its session directory**: after `library.json` commit, `delete_book` removes `<app_data>/sessions/<bookId>/`. Missing directory is success. Failure after the book record is gone is `StorageIo` without rolling the book back.

---

## Common Mistakes

### Using content hash as bookId

**Wrong**: replace path-hash `bookId` with SHA-256 of bytes so duplicates share an id.

**Correct**: keep path-hash `bookId` (sessions, trash, `contentVersion` stay stable). Store SHA-256 as `contentHash` and classify imports as `duplicate` / `overwrite` / `new`.

### Hashing the wrong path for bookId

**Wrong**: hashing the app data copy path (`dest_path`) — it's stable per bookId but changes if the library is rebuilt, and two different source files could theoretically collide.

**Correct**: hash the **source file path** before staging. See `import_book` in `src-tauri/src/library.rs`.

### Treating missing or corrupt library.json as an empty library

**Wrong**: `read_library().unwrap_or(LibraryData::empty())` after initialization.

**Correct**: initialization alone creates the first empty versioned file. Runtime reads propagate `StorageIo` / `StorageCorrupt` so existing data is never overwritten by an empty fallback.

### Writing library.json without creating the directory first

Initialization creates and validates real (non-symlink) storage directories. Any new internal path must be derived from the trusted root, validate its identifier, verify its direct parent, and use the atomic writer.
