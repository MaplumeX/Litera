# Tauri IPC Commands

> Tauri command contracts between WebView (React) and Rust backend.

---

## Overview

Litera uses Tauri v2 commands as the IPC bridge between the React WebView and the Rust backend. This document records the executable contracts for each command family.

---

## Library Management Commands

### Scope / Trigger

Book library persistence: import, metadata, list, open, delete, and reading state. Cross-layer contract — frontend `invoke()` calls must match Rust `#[tauri::command]` signatures exactly (camelCase serialization).

### Signatures

```rust
// Import: pick/read once → stage exact bytes → return lightweight identity
#[tauri::command]
async fn import_book(app: AppHandle, store: State<'_, LibraryStore>) -> AppResult<ImportBookResult>

// Read only that staged import as a Raw IPC body
#[tauri::command]
async fn read_import_bytes(store: State<'_, LibraryStore>, book_id: String, import_id: String) -> AppResult<tauri::ipc::Response>

// Commit extracted metadata + cover and the staged EPUB as one recoverable import version
#[tauri::command]
async fn save_book_metadata(store: State<'_, LibraryStore>, book_id: String, title: String, author: String, cover_bytes: Option<Vec<u8>>, import_id: String) -> AppResult<BookRecord>

// List all books
#[tauri::command]
async fn list_books(store: State<'_, LibraryStore>) -> AppResult<Vec<BookRecord>>

// Read lightweight metadata and the active committed content version
#[tauri::command]
async fn get_book_open_context(store: State<'_, LibraryStore>, book_id: String) -> AppResult<BookOpenContext>

// Read the exact active version as a Raw IPC body
#[tauri::command]
async fn read_book_bytes(store: State<'_, LibraryStore>, book_id: String, content_version: String) -> AppResult<tauri::ipc::Response>

// Read the exact active version as Raw IPC and notify the sidecar after success
#[tauri::command]
async fn open_book_bytes(app: AppHandle, store: State<'_, LibraryStore>, book_id: String, content_version: String) -> AppResult<tauri::ipc::Response>

// Delete book: remove record + directory
#[tauri::command]
async fn delete_book(store: State<'_, LibraryStore>, book_id: String) -> AppResult<()>

// Update reading position/settings (called on relocate debounce + settings change debounce)
#[tauri::command]
async fn update_reading_state(store: State<'_, LibraryStore>, book_id: String, last_fraction: Option<f64>, settings: Option<ReadingSettings>) -> AppResult<()>
```

### Contracts

**Rust ↔ Frontend serialization**: Rust struct fields use `#[serde(rename = "camelCase")]` to match TypeScript interfaces.

```typescript
// Frontend types (src/types/library.ts)
interface BookRecord {
  id: string;
  title: string;
  author: string;
  coverPath: string;    // absolute path to app_data/books/<id>/cover.png
  filePath: string;     // absolute path to app_data/books/<id>/book.epub
  importedAt: string;   // ISO 8601 (RFC3339)
  lastFraction?: number;
  settings?: ReadingSettings;
}

interface ReadingSettings {
  fontSize?: number;
  fontFamily?: string;
  theme?: string;  // "light" | "dark" | "sepia"
}

interface ImportBookResult { bookId: string; importId: string; name: string }
interface BookOpenContext {
  name: string;
  bookId: string;
  contentVersion: string;
  lastFraction?: number;
  settings?: ReadingSettings;
}
```

**Raw byte boundary**: `read_import_bytes`, `read_book_bytes`, and `open_book_bytes` return `tauri::ipc::Response::new(Vec<u8>)`. Frontend callers use `invoke<ArrayBuffer>()` and create a `Uint8Array` view; EPUB payloads are never JSON `number[]`.

**Version-bound open**: `get_book_open_context` returns the active `contentVersion`. Both book byte commands require that token and validate it under the same `LibraryStore` gate used to locate and read the controlled `book.epub`. A re-import committed between the context and byte calls makes the old token fail with `InvalidInput`, so metadata/progress cannot be paired with bytes from another version. A staged but uncommitted import token cannot open canonical content.

**Storage layout** (Tauri app data dir):
```
<app_data>/
├── library.json         # { schemaVersion: 1, books: BookRecord[] }
├── books/<bookId>/
│   ├── book.epub
│   ├── cover.png
│   ├── .imports/        # uncommitted exact import bytes
│   └── .transactions/   # crash-recovery journals (temporary)
├── books/.trash/        # recoverable staged deletions
├── backup/legacy-*/     # legacy reset backups; never silently discarded
└── sessions/<bookId>/    # sidecar-managed, not touched by library commands
```

**bookId generation**: `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record. Each import also receives an unpredictable UUID `importId` that binds frontend-extracted metadata and staged Raw IPC access to the exact bytes.

**Repeat-import transaction**: `import_book` reads the selected EPUB once and stages those exact bytes without replacing the current EPUB. `save_book_metadata(importId)` creates a persistent rollback journal, switches EPUB/cover, and atomically commits metadata plus an internal `contentVersion` in `library.json`. A parse/save failure leaves the previous complete version active. Startup restores a prepared transaction when `contentVersion` did not commit, and keeps the new version when it did.

**Serialization boundary**: all commands return serializable `{ code, message }` errors. Frontend cancellation handling checks `code === "Cancelled"`; storage failures must be rendered to the user rather than silently converted to an empty library.

**Cover display**: Frontend uses `convertFileSrc(coverPath)` from `@tauri-apps/api/core` to render covers via Tauri's asset protocol. Requires:
- `tauri.conf.json` → `app.security.assetProtocol.enable = true` + `scope = ["$APPDATA/books/**"]`
- `tauri` Cargo dependency with `features = ["protocol-asset"]`
- CSP `img-src` must include `asset:` and `http://asset.localhost`

### Validation & Error Matrix

| Condition | Error |
|-----------|-------|
| User cancels file picker | `{ code: "Cancelled", ... }` — frontend ignores only this code |
| Invalid ID/path/fraction/settings/import token | `{ code: "InvalidInput", ... }` |
| Stale `contentVersion` after a committed re-import | `{ code: "InvalidInput", ... }` |
| Book not found before any file mutation | `{ code: "BookNotFound", ... }` |
| Invalid JSON/schema/record fields/controlled paths | `{ code: "StorageCorrupt", ... }` |
| File read/write/sync/rename failure | `{ code: "StorageIo", ... }` |
| Failed compensating restore | `{ code: "RollbackFailed", ... }` |

### Good/Base/Bad Cases

- **Good**: Import epub with cover → grid shows cover, title, author; reopen app → book persists
- **Base**: Import epub without cover → grid shows placeholder (first char of title)
- **Bad**: Re-import same file, then metadata extraction fails → old EPUB/title/author/cover remain active; staged bytes never partially replace them

### Tests Required

- **Atomic library writes**: inject a write failure and assert the prior `library.json` bytes remain complete and parseable.
- **Concurrent partial updates**: race fraction and settings updates, then assert the final record contains both values.
- **Import commit boundary**: stage changed bytes for an existing book, fail metadata/library commit, and assert EPUB, metadata, and cover all remain on the previous version.
- **Crash recovery**: leave a prepared import journal and a staged deletion on disk, reinitialize `LibraryStore`, and assert the uncommitted import is rolled back while the referenced deleted directory is restored.
- **Path safety**: reject traversal-like IDs, forged stored paths, duplicate IDs, symlink book directories, and non-regular EPUB/cover files before mutation.
- **Frontend lifecycle**: assert debounce keeps the latest call, `flush()` waits and propagates failures, and repeated `cancel()` is safe under StrictMode cleanup.

### Storage and path rules

- Every `library.json` read/modify/write and every related file transition is inside the shared `LibraryStore` gate.
- `library.json` writes use a same-directory temporary file, flush + `sync_all`, atomic persist, and parent-directory sync. Post-persist failures restore the prior complete bytes.
- Stored `filePath` must equal `<appData>/books/<bookId>/book.epub`; non-empty `coverPath` must equal `<appData>/books/<bookId>/cover.png`. Commands derive operational paths again from the trusted root and never follow stored paths.
- `books`, `.trash`, book directories, `.imports`, and `.transactions` must be real directories, not symlinks. EPUB/cover/transaction files must be regular files.
- Delete renames the book directory into `.trash` before committing metadata. A write failure renames it back; startup also restores an interrupted pre-commit staged deletion. Committed trash is retained for an explicit future retention policy.
- Startup moves an unregistered real book directory (for example, a crash during first import before `library.json` commit) into `.trash/orphan-*`; it rejects unregistered files and symlinks instead of following them.
- All synchronous dialog and filesystem work runs inside `spawn_blocking`; library commands are async.

### Wrong vs Correct

#### Wrong — bookId from app data copy path
```rust
// After copying to app_data, hash the dest path
let book_id = hash(&dest_path); // WRONG: dest path is stable but two different source files
                                 // copied to same slot would collide; also changes if re-imported
```

#### Correct — bookId from source file path
```rust
// Hash the ORIGINAL source path before copying
let book_id = {
    let path_str = src_path.to_string_lossy();
    let mut hasher = DefaultHasher::new();
    path_str.hash(&mut hasher);
    format!("{:x}", hasher.finish())
};
// Then stage each import under its importId; do not replace the active EPUB
// until save_book_metadata commits that exact staged version.
```

---

## File Dialog Commands

### Gotcha: blocking dialog in sync command causes deadlock

> **Warning**: Tauri v2 non-async commands run on the main thread. `blocking_pick_file()` needs the main thread to show the dialog → deadlock. See `error-handling.md` for full details.
>
> **Rule**: Any command calling `blocking_*` dialog APIs or sync blocking I/O must be `async fn` with `spawn_blocking` for the blocking part.

The legacy `open_file` command is removed. `import_book` is the only file-dialog entry point, and all EPUB bytes cross IPC through the Raw commands above.

---

## Sidecar Communication Commands

Existing commands (`agent_prompt`, `agent_abort`, `list_sessions`, `new_session`, `switch_session`, `delete_session`) are unchanged. They forward JSON lines to the sidecar stdin via `write_to_sidecar()`.

### Convention: sidecar book_opened notification

`open_book_bytes` notifies the sidecar via `notify_sidecar_book_opened()` with the controlled EPUB path + bookId + sessionsDir only after the version-bound read succeeds. Runtime callers never supply a filesystem path.
