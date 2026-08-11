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
// Import: pick file → copy epub to app_data/books/<id>/ → return bytes + bookId for frontend metadata extraction
#[tauri::command]
async fn import_book(app: AppHandle) -> Result<ImportBookResult, String>

// Save extracted metadata + cover (called by frontend after foliate.js extraction)
#[tauri::command]
async fn save_book_metadata(app: AppHandle, book_id: String, title: String, author: String, cover_bytes: Option<Vec<u8>>) -> Result<BookRecord, String>

// List all books
#[tauri::command]
fn list_books(app: AppHandle) -> Result<Vec<BookRecord>, String>

// Open book from library: read epub bytes + notify sidecar
#[tauri::command]
async fn open_book(app: AppHandle, book_id: String) -> Result<OpenBookResult, String>

// Delete book: remove record + directory
#[tauri::command]
async fn delete_book(app: AppHandle, book_id: String) -> Result<(), String>

// Update reading position/settings (called on relocate debounce + settings change debounce)
#[tauri::command]
fn update_reading_state(app: AppHandle, book_id: String, last_fraction: Option<f64>, settings: Option<ReadingSettings>) -> Result<(), String>
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

interface ImportBookResult { bytes: number[]; bookId: string }
interface OpenBookResult  { bytes: number[]; name: string; bookId: string; lastFraction?: number; settings?: ReadingSettings }
```

**Storage layout** (Tauri app data dir):
```
<app_data>/
├── library.json         # { books: BookRecord[] }
├── books/<bookId>/
│   ├── book.epub
│   └── cover.png
└── sessions/<bookId>/    # sidecar-managed, not touched by library commands
```

**bookId generation**: `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file → same bookId → duplicate import is a no-op (skips copy, returns existing).

**Cover display**: Frontend uses `convertFileSrc(coverPath)` from `@tauri-apps/api/core` to render covers via Tauri's asset protocol. Requires:
- `tauri.conf.json` → `app.security.assetProtocol.enable = true` + `scope = ["$APPDATA/books/**"]`
- `tauri` Cargo dependency with `features = ["protocol-asset"]`
- CSP `img-src` must include `asset:` and `http://asset.localhost`

### Validation & Error Matrix

| Condition | Error |
|-----------|-------|
| User cancels file picker | `Err("No file selected")` — frontend should catch and ignore |
| Book not found in library.json (open/delete/update) | `Err("Book not found: <id>")` |
| epub read failure (missing file) | `Err("Failed to read epub: <io error>")` |
| library.json parse failure | `Err("Failed to parse library.json: <serde error>")` |
| Cover write failure | `Err("Failed to write cover: <io error>")` |

### Good/Base/Bad Cases

- **Good**: Import epub with cover → grid shows cover, title, author; reopen app → book persists
- **Base**: Import epub without cover → grid shows placeholder (first char of title)
- **Bad**: Re-import same file → no duplicate (bookId dedup), returns existing bytes

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
// Then check dedup against library.json BEFORE copying
```

---

## File Dialog Commands

### Gotcha: blocking dialog in sync command causes deadlock

> **Warning**: Tauri v2 non-async commands run on the main thread. `blocking_pick_file()` needs the main thread to show the dialog → deadlock. See `error-handling.md` for full details.
>
> **Rule**: Any command calling `blocking_*` dialog APIs or sync blocking I/O must be `async fn` with `spawn_blocking` for the blocking part.

### Existing: open_file (legacy)

The original `open_file` command is retained for compatibility but the app now defaults to library-first flow. `import_book` is the primary entry point for adding books.

---

## Sidecar Communication Commands

Existing commands (`agent_prompt`, `agent_abort`, `list_sessions`, `new_session`, `switch_session`, `delete_session`) are unchanged. They forward JSON lines to the sidecar stdin via `write_to_sidecar()`.

### Convention: sidecar book_opened notification

Both `open_file` and `open_book` notify the sidecar via `notify_sidecar_book_opened()` with the epub path + bookId + sessionsDir. This must be called whenever a book is opened for rendering, so the sidecar can parse the epub and index it for the agent tools.