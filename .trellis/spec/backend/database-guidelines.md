# Database Guidelines

> Persistence patterns for the Litera backend. This project has **no traditional database** — persistence is file-based (JSON/JSONL) and full-text search uses an in-memory SQLite FTS5 index.

---

## Overview

Litera uses two distinct persistence mechanisms, neither of which is a relational database:

1. **Library storage** — `library.json` in the Tauri app data directory. Rust reads/writes it directly via `serde_json`. No ORM, no migrations, no query builder.
2. **Session storage** — JSONL session files managed by the sidecar's `SessionManager` (from `@earendil-works/pi-coding-agent`), under `<app_data>/sessions/<bookId>/`.
3. **Full-text search** — In-memory SQLite FTS5 (WASM via `fts5-sql-bundle`), rebuilt on each book open. Not persisted to disk.

Reference files:
- `src-tauri/src/lib.rs` — `read_library()`, `write_library()`, `LibraryData`, `BookRecord`
- `sidecar/book.ts` — `loadBook()`, FTS5 index construction
- `sidecar/index.ts` — `SessionManager` usage

---

## Library Storage (library.json)

### Pattern: read-modify-write the entire file

Every library mutation reads the full `library.json`, modifies the `books` vector, and writes the entire file back. There is no incremental update.

```rust
// src-tauri/src/lib.rs
fn read_library(app: &tauri::AppHandle) -> Result<LibraryData, String> {
    let path = app_data_dir(app)?.join("library.json");
    if !path.exists() {
        return Ok(LibraryData { books: vec![] });
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read library.json: {e}"))?;
    serde_json::from_str::<LibraryData>(&content)
        .map_err(|e| format!("Failed to parse library.json: {e}"))
}

fn write_library(app: &tauri::AppHandle, data: &LibraryData) -> Result<(), String> {
    let path = app_data_dir(app)?.join("library.json");
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize library: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write library.json: {e}"))
}
```

### Conventions

- **`serde_json::to_string_pretty`** for human-readable output (debugging-friendly).
- **Missing file = empty state**: `read_library` returns `LibraryData { books: vec![] }` if `library.json` doesn't exist. Never error on a missing file.
- **`unwrap_or(LibraryData { books: vec![] })`** as a defensive fallback when reading before writing (see `import_book`, `delete_book`, `update_reading_state`).
- **bookId dedup check before write**: `if library.books.iter().any(|b| b.id == book_id)` — check existence before inserting to avoid duplicates.

### Storage Layout

```
<app_data>/
├── library.json              # { "books": [BookRecord, ...] }
├── books/<bookId>/
│   ├── book.epub             # copied epub
│   └── cover.png             # optional cover
└── sessions/<bookId>/        # sidecar-managed JSONL session files
```

### bookId Generation

`bookId` is a `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file → same bookId → duplicate import is a no-op.

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
- **`snippet()` for excerpts**: `snippet(chapters, 0, '【', '】', '…', 16)` returns a 16-token excerpt with match markers.
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

---

## Common Mistakes

### Hashing the wrong path for bookId

**Wrong**: hashing the app data copy path (`dest_path`) — it's stable per bookId but changes if the library is rebuilt, and two different source files could theoretically collide.

**Correct**: hash the **source file path** before copying. See `import_book` in `src-tauri/src/lib.rs`.

### Forgetting to handle missing library.json

**Wrong**: erroring when `library.json` doesn't exist on first run.

**Correct**: return `LibraryData { books: vec![] }` for a missing file. See `read_library`.

### Writing library.json without creating the directory first

`write_library` calls `std::fs::create_dir_all(&dir)` before writing. Any new write path must ensure the parent directory exists.