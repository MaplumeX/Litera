# Tauri IPC Commands

> Tauri command contracts between WebView (React) and Rust backend.

---

## Overview

## Embedded Agent Command Family

### 1. Scope / Trigger

These commands are the only privileged boundary used by the embedded WebView
Agent. Rust resolves active credentials and owns Pi v3 JSONL filesystem access;
the WebView owns orchestration, streaming, branch projection, and EPUB tools.

### 2. Signatures

```rust
async fn get_agent_runtime_config(app: AppHandle) -> AppResult<AgentRuntimeConfig>
async fn create_agent_session(app: AppHandle, book_id: String) -> AppResult<LoadedPiSession>
async fn list_agent_sessions(app: AppHandle, book_id: String) -> AppResult<Vec<PiSessionSummary>>
async fn load_agent_session(app: AppHandle, book_id: String, session_id: String) -> AppResult<LoadedPiSession>
async fn append_agent_session_entries(
    app: AppHandle,
    book_id: String,
    session_id: String,
    expected_leaf_id: Option<String>,
    entries: Vec<Value>,
) -> AppResult<Option<String>>
async fn delete_agent_session(app: AppHandle, book_id: String, session_id: String) -> AppResult<()>
```

`AgentRuntimeConfig` contains `provider`, `model`, `api`, `baseUrl`, the
active `apiKey`, and `thinkingLevel` (global, from `settings.json`
`defaultThinkingLevel`). `LoadedPiSession` contains the v3 `header`, raw `entries`, and
`leafId`. Session summaries contain only id, derived title, and timestamps.

### 3. Contracts

- `get_agent_runtime_config` resolves the exact active model API and HTTP(S)
  base URL. The plaintext key exists only for that request and must never enter
  logs, reducer state, JSONL, browser storage, or surfaced errors.
- Session files live at `<app_data>/sessions/<bookId>/*.jsonl`. Rust validates
  real directories/files, containment, ids, headers, timestamps, parent links,
  line/file/batch caps, and performs all blocking work via `spawn_blocking`.
- Creation writes a Pi v3 header immediately. Load migrates v1/v2 only after a
  `.pre-v3.bak` backup and atomically replaces the source. Normal v3 interaction
  is append-only.
- Append is optimistic. `expectedLeafId` must match the durable leaf (including
  `null` for a header-only session); the returned value is the new durable leaf.
  Rewinding chooses a branch parent in the frontend but does not change the
  expected durable leaf used for the append race check.
- A valid final JSON value without a newline is preserved and receives the
  delimiter before append. Only an invalid final fragment may be truncated, and
  corruption before it is always `StorageCorrupt`.

### 4. Validation & Error Matrix

| Condition | Error / result |
|-----------|----------------|
| Missing active provider, model, key, or invalid base URL | `InvalidInput` with credential-free text |
| Invalid/traversal id, unknown session, duplicate session id | `InvalidInput` |
| Symlink/non-regular session path, bad schema/header/parent/timestamp, earlier corruption | `StorageCorrupt` |
| File/lock/worker/read/write/sync/rename failure | `StorageIo` |
| `expectedLeafId` differs from the durable leaf | `InvalidInput` stale-leaf failure; no bytes appended |
| Entry, batch, line, or file exceeds its cap | `InvalidInput`; no partial append |
| Missing book session directory during list | empty list |

### 5. Good/Base/Bad Cases

- **Good**: two prompts append against the current leaf and reload as the same
  Pi v3 tree after restart.
- **Good**: a v2 file loads once, keeps a `.pre-v3.bak`, and thereafter remains
  append-only v3.
- **Base**: a newly created header-only session is visible before its first
  message and uses `expectedLeafId: null`.
- **Bad**: an old concurrent prompt appends after another writer advanced the
  file; Rust rejects it instead of creating a silent fork.
- **Bad**: a model error containing a request URL or authorization material is
  forwarded to reducer state; transport/runtime code must redact it first.

### 6. Tests Required

- Create/list/load/append/delete and v1/v2-to-v3 backup migration.
- Valid no-newline recovery, invalid-tail truncation, and earlier-corruption
  rejection.
- Traversal, symlink, non-file, size/line/batch caps, bad parents/timestamps, and
  duplicate/unknown session handling.
- Concurrent stale-leaf rejection and edit/rewind separation between durable
  expected leaf and branch parent.
- Built-in/custom runtime config resolution, API selection, cache invalidation,
  native transport origin/redirect guards, and credential redaction.

### 7. Wrong vs Correct

#### Wrong

```ts
// The visible branch parent is not necessarily the current durable file leaf.
await appendEntries({ expectedLeafId: editedMessage.parentId, entries });
```

#### Correct

```ts
// Race against the durable leaf, while entries may parent from the rewound branch.
await appendEntries({ expectedLeafId: session.leafId, entries });
```

Litera uses Tauri v2 commands as the IPC bridge between the React WebView and the Rust backend. This document records the executable contracts for each command family.

---

## Library Management Commands

### Scope / Trigger

Book library persistence: import, metadata, list, open, delete, and reading state. Cross-layer contract — frontend `invoke()` calls must match Rust `#[tauri::command]` signatures exactly (camelCase serialization).

### Signatures

```rust
// Import: native multi-file picker → classify each EPUB → return outcomes
#[tauri::command]
async fn import_book(app: AppHandle, store: State<'_, LibraryStore>) -> AppResult<Vec<ImportBookResult>>

// Import from OS drag-drop paths (not a free-typed path field)
#[tauri::command]
async fn import_paths(store: State<'_, LibraryStore>, paths: Vec<String>) -> AppResult<Vec<ImportBookResult>>

// Drain OS-open queue filled by argv / RunEvent::Opened / single-instance
#[tauri::command]
fn take_pending_open_paths(state: State<'_, OpenedPaths>) -> Vec<String>

// Discard a staged overwrite the user cancelled
#[tauri::command]
async fn discard_import(store: State<'_, LibraryStore>, book_id: String, import_id: String) -> AppResult<()>

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

// Read the exact active version as Raw IPC and update lastOpenedAt best-effort
#[tauri::command]
async fn open_book_bytes(app: AppHandle, store: State<'_, LibraryStore>, book_id: String, content_version: String) -> AppResult<tauri::ipc::Response>

// Delete book: remove record + directory
#[tauri::command]
async fn delete_book(store: State<'_, LibraryStore>, book_id: String) -> AppResult<()>

// Update reading position/settings/mode (relocate debounce + settings debounce + mode toggle)
#[tauri::command]
async fn update_reading_state(
    store: State<'_, LibraryStore>,
    book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
    last_reader_mode: Option<String>,
) -> AppResult<()>

// Per-book bookmarks + highlights (not BookRecord / library.json)
#[tauri::command]
async fn get_annotations(store: State<'_, LibraryStore>, book_id: String) -> AppResult<AnnotationsFile>

#[tauri::command]
async fn save_annotations(store: State<'_, LibraryStore>, book_id: String, data: AnnotationsFile) -> AppResult<()>
```

### Contracts

**Rust ↔ Frontend serialization**: Rust struct fields use `#[serde(rename = "camelCase")]` to match TypeScript interfaces.

```typescript
// Frontend types (src/types/library.ts)
interface BookRecord {
  id: string;
  title: string;
  author: string;
  coverPath: string;    // absolute path to app_data/books/<id>/cover.jpg (new) or cover.png (legacy)
  filePath: string;     // absolute path to app_data/books/<id>/book.epub
  importedAt: string;   // ISO 8601 (RFC3339)
  lastFraction?: number;
  settings?: ReadingSettings;
  lastOpenedAt?: string;  // RFC3339; missing = never opened
  contentHash?: string;   // SHA-256 hex of committed EPUB bytes
  lastReaderMode?: "reader" | "agent";  // missing = no memory; do not put on settings
}

interface ReadingSettings {
  fontSize?: number;           // px, 12–32
  fontFamily?: string;         // generic or named family; see is_valid_font_family
  theme?: string;              // "light" | "dark" | "sepia" — legacy per-book value, accepted for old files, never written
  lineHeight?: number;         // 1.2–2.4; leftover "compact"|"normal"|"relaxed" dual-read as 1.4/1.7/2.0
  pageMargin?: string;         // leftover "narrow"|"normal"|"wide"; read-only, never written
  contentWidth?: number;       // em, 28–60
  pagePadding?: number;        // rem, 0.5–4
  textAlign?: string;          // "start" | "justify"
  letterSpacing?: number;      // em, -0.05–0.2
  paragraphSpacing?: number;   // em, 0–2
  firstLineIndent?: number;    // em, 0–3
}

type ImportStatus = "new" | "overwrite" | "duplicate";
interface ImportBookResult {
  status: ImportStatus;
  bookId: string;
  title: string;          // existing title, or source filename for new
  importId?: string;      // present only for new / overwrite
  name: string;           // source filename for foliate extract
}
interface BookOpenContext {
  name: string;           // still "book.epub" for File()
  title: string;          // stored library title for the reader chrome
  bookId: string;
  contentVersion: string;
  lastFraction?: number;
  settings?: ReadingSettings;
  lastReaderMode?: "reader" | "agent";
}

interface BookmarkRecord {
  id: string;
  cfi: string;
  fraction: number;       // 0..=1; jump fallback after overwrite
  createdAt: string;      // RFC3339
  label?: string;         // toc label at pin time
}

interface HighlightRecord {
  id: string;
  cfi: string;
  excerpt: string;
  createdAt: string;
}

interface AnnotationsFile {
  schemaVersion: number;  // 1; own version, not library.json
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
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
│   ├── cover.jpg          # compressed JPEG (max edge 512px, q85); legacy books may have cover.png
│   ├── annotations.json # optional; bookmarks + highlights snapshot
│   ├── .imports/        # uncommitted exact import bytes
│   └── .transactions/   # crash-recovery journals (temporary)
├── books/.trash/        # recoverable staged deletions
├── backup/legacy-*/     # legacy reset backups; never silently discarded
└── sessions/<bookId>/   # Rust-managed Pi v3 content under a validated root
```

**bookId generation**: `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record. Content identity is a separate SHA-256 of EPUB bytes (`contentHash`). Do not change `bookId` to a content hash.

**Import classification** (after `backfill_missing_content_hashes`, before creating `importId` / writing `.imports`):
- `duplicate` — any existing book's `contentHash` equals the incoming SHA-256, including the same-path record. Do not stage. Return that book's `bookId` + `title`. `importId` is absent.
- `overwrite` — same path `bookId` exists **and** the incoming hash differs (or is still missing after backfill). Stage pending bytes only. Frontend must confirm, then `save_book_metadata`, or `discard_import`.
- `new` — no matching `bookId` and no matching `contentHash`. Stage and insert the record as before.

Do not filter `book.id != incoming_id` when matching `contentHash`. That made same-path unchanged look like `overwrite` and popped a replace dialog on every OS reopen of the same file.

`save_book_metadata` writes `contentHash` from the staged bytes. An overwrite must keep `lastFraction`, `settings`, `lastOpenedAt`, and `lastReaderMode`. Same-path unchanged is a no-op on `library.json` and the committed EPUB. Overwrite also leaves `books/<id>/annotations.json` in place.

**Cover compression**: `save_book_metadata` compresses incoming `cover_bytes` before writing — decode with the `image` crate, downscale so the long edge ≤ 512px (never upscale), re-encode as JPEG quality 85, and write to `cover.jpg` (not `cover.png`). On any decode/encode failure, fall back to the original bytes so a broken cover never blocks an import. `MAX_COVER_BYTES` validates the raw input before compression. Legacy books with `cover.png` are not migrated; validation and transaction rollback accept both extensions. Frontend `convertFileSrc(coverPath)` works with any extension.

**Annotations**: `get_annotations` / `save_annotations` read and replace `books/<bookId>/annotations.json` under the `LibraryStore` gate. Missing file → `{ schemaVersion: 1, bookmarks: [], highlights: [] }`, not corrupt. Invalid JSON / unknown fields / unsupported `schemaVersion` → `StorageCorrupt`. `save_annotations` is a full snapshot replace (same contract as `settings`). Validate unique ids, non-empty `epubcfi(...)` locators, bookmark `fraction` in `0..=1`, and excerpt/label byte caps. Frontend must not `save_annotations` until `get_annotations` for that book succeeded — a failed load must not be treated as empty and written back. Cap highlight excerpts to the same UTF-8 byte limit on the client before save. Do not add annotation fields to `BookRecord`. Do not add WebView `fs` permission.

**list_books order**: `lastOpenedAt` descending (missing last), then `importedAt` descending. Frontend search filters; it does not re-sort.

**Open context / last opened**: `get_book_open_context` returns `title` and backfills a missing `contentHash` from the stored EPUB under the store lock. After reading the validated bytes, `open_book_bytes` writes `lastOpenedAt` best-effort (log on failure, do not fail the open).

**Repeat-import transaction**: `import_book` / `import_paths` read EPUB bytes and stage them without replacing the current EPUB until `save_book_metadata(importId)`. A parse/save failure leaves the previous complete version active. Startup restores a prepared transaction when `contentVersion` did not commit, and keeps the new version when it did.

**Delete**: after the existing trash + `library.json` commit, `delete_book` removes `sessions/<bookId>/`. Missing session dir is success. If session removal fails after the book record is gone, return `StorageIo` and do not roll the book back.

**Drag-drop paths**: `import_paths` accepts only OS drop / picker-equivalent absolute paths. Reject non-`.epub`, symlinks, and non-regular files. Do not add `dialog` / `fs` / `opener` permissions to the WebView capability.

**OS file open**: system "Open With" / double-click is a third path source. It must reuse `import_paths` after `take_pending_open_paths`. See "Scenario: OS EPUB open" below.

## Scenario: lastReaderMode

### 1. Scope / Trigger

Cross-layer reading-state field. The WebView resolves reader vs Agent layout; Rust persists the last mode on the book record. App default must not go through this command.

### 2. Signatures

```rust
async fn update_reading_state(
    store: State<'_, LibraryStore>,
    book_id: String,
    last_fraction: Option<f64>,
    settings: Option<ReadingSettings>,
    last_reader_mode: Option<String>,
) -> AppResult<()>

// BookOpenContext / BookRecord include:
// last_reader_mode: Option<String>  // wire name lastReaderMode
```

### 3. Contracts

- Request: `lastReaderMode` is omitted, `"reader"`, or `"agent"`. Independent of `lastFraction` and `settings`. At least one of the three Options is required.
- Response: `BookOpenContext.lastReaderMode` is omitted when the book has no memory.
- Environment: none. App default is WebView-only: `localStorage["litera.defaultReaderMode"]`.
- Overwrite import keeps `lastReaderMode` with `lastFraction` / `settings` / `lastOpenedAt`.
- Changing the Settings default must not call this command and must not patch existing books.

### 4. Validation & Error Matrix

- all three Options `None` → `InvalidInput` ("At least one reading state field is required")
- `lastReaderMode` present and not `"reader"` / `"agent"` → `InvalidInput` on write
- stored `lastReaderMode` present and not `"reader"` / `"agent"` → `StorageCorrupt` on read
- missing field on old `library.json` → valid (`None`)
- unknown book → `BookNotFound`

### 5. Good/Base/Bad Cases

- Good: `{ lastReaderMode: "agent" }` writes only the mode; fraction and settings stay.
- Base: omitted field on an old book; open uses `litera.defaultReaderMode` or `"reader"`.
- Bad: `{ lastReaderMode: "dark" }` or stuffing mode into `ReadingSettings`.

### 6. Tests Required

- Missing field loads; write/read round-trip; `BookOpenContext` returns the value.
- Mode update does not clobber fraction or settings; fraction/settings updates do not clobber mode.
- Invalid update rejected; invalid stored value is `StorageCorrupt`.
- Frontend: book memory wins over default; changing default does not invoke `update_reading_state` for mode.

### 7. Wrong vs Correct

#### Wrong
```ts
await invoke("save_preferences", { defaultReaderMode: "agent" });
await invoke("update_reading_state", { bookId, settings: { lastReaderMode: "agent" } });
```

#### Correct
```ts
localStorage.setItem("litera.defaultReaderMode", "agent");
await invoke("update_reading_state", { bookId, lastReaderMode: "agent" });
```

## Scenario: OS EPUB open

### 1. Scope / Trigger

- Trigger: `bundle.fileAssociations` registers `.epub`. Finder / Explorer / the file manager launches Litera or forwards a path to the running instance.
- Cross-layer: OS → Rust queue → empty `open-paths-available` event → App `take` → `import_paths` → `open_book_bytes`.

### 2. Signatures

```rust
#[tauri::command]
fn take_pending_open_paths(state: State<'_, OpenedPaths>) -> Vec<String>
```

```json
// tauri.conf.json bundle.fileAssociations
{ "ext": ["epub"], "mimeType": "application/epub+zip", "name": "EPUB", "role": "Viewer", "rank": "Default" }
```

Do not set `exportedType`. EPUB is a public type.

### 3. Contracts

- `take_pending_open_paths` **drains** the queue and returns absolute path strings. Empty queue → `[]`, not an error.
- Event `open-paths-available` has an empty payload. It is a wake-up only; the frontend must `take`, never trust emitted paths.
- Sources:
  - macOS: `RunEvent::Opened` `file://` URLs (also iOS/Android if enabled later).
  - Windows / Linux cold start: `std::env::args()` in `setup`.
  - Windows / Linux hot start: `tauri-plugin-single-instance` callback `(app, args, cwd)` — first registered plugin, then restore `main` to the foreground: `unminimize()` → `show()` → `set_focus()`. `set_focus` alone is a no-op on minimized windows on all three platforms (tao 0.35.3), so the restore sequence must run in that order.
- Parser drops argv[0], `-` flags, non-`.epub`, non-`file` schemes. Relative args join the provided `cwd`.
- Do not `canonicalize` a symlink: that would turn it into a regular file and skip `import_paths` `InvalidInput`.
- Queue insert is path-unique. Frontend also ignores a path successfully imported in the last 5s (macOS argv + `Opened` can deliver the same file twice). Failed / cancelled imports clear that recent entry so retry works.
- After a batch: open the last successful book (`new` committed, `duplicate`, or confirmed `overwrite`). Picker / drag-drop still import without auto-open.
- App owns the listener. `LibraryView` unmounts in the reader, so OS-open and overwrite confirm cannot live only there.

### 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Empty queue take | `[]` |
| Flag / argv0 / non-epub / `https:` | Dropped before queue (no banner; association is epub-only) |
| Symlink or non-regular `.epub` | Queued → `import_paths` → `{ code: "InvalidInput" }` visible |
| Unreadable `.epub` | `{ code: "StorageIo" }` visible; later files still process |
| Same path in one queue | Insert once |
| argv then Opened same path within 5s | Second take ignored after first success |
| Overwrite cancelled | No library change; recent-path entry cleared; rest of batch continues |
| Same path, same `contentHash` | `duplicate` — no confirm; OS-open still opens that book |

### 5. Good/Base/Bad Cases

- **Good**: cold-start a new `.epub` → imported and reader opens that book.
- **Good**: cold-start the same unchanged `.epub` already in the library → `duplicate`, no overwrite dialog, reader opens that book.
- **Base**: app already running → existing window focuses, imports, opens last success; no second process.
- **Bad**: emit path lists and also leave them in the queue → cold start processes the same path twice.

### 6. Tests Required

- Rust: `file://` (including percent-encoding), relative + cwd, skip flags/non-epub/other schemes, drop argv0, take drains, symlink not canonicalized, queue unique insert.
- Frontend: listen then take opens last success; empty take does not open; cancelled overwrite still opens a later success; dispose before listen resolves unlistens; 5s burst of the same path is ignored; failed import allows immediate retry.

### 7. Wrong vs Correct

#### Wrong

```rust
app.emit("opened", urls); // payload + leftover queue
path.canonicalize()?;     // follows symlink, bypasses import_paths reject
```

```ts
listen("opened", (e) => importPaths(e.payload));
const again = await invoke("opened_urls"); // same paths twice
```

#### Correct

```rust
enqueue_paths(app, parsed); // unique insert, then emit ()
take_pending_open_paths     // drain
```

```ts
listen("open-paths-available", () => drain());
const paths = await invoke("take_pending_open_paths");
```

**Serialization boundary**: all commands return serializable `{ code, message }` errors. Frontend cancellation handling checks `code === "Cancelled"`; storage failures must be rendered to the user rather than silently converted to an empty library.

**Cover display**: Frontend uses `convertFileSrc(coverPath)` from `@tauri-apps/api/core` to render covers via Tauri's asset protocol. Requires:
- `tauri.conf.json` → `app.security.assetProtocol.enable = true` + `scope = ["$APPDATA/books/**"]`
- `tauri` Cargo dependency with `features = ["protocol-asset"]`
- CSP `img-src` must include `asset:` and `http://asset.localhost`

## Preferences Commands

### 1. Scope / Trigger

Global app preferences in `<app_data>/preferences.json`: theme plus typography defaults (`fontSize`, `fontFamily`, `lineHeight`, `contentWidth`, `pagePadding`, `textAlign`, `letterSpacing`, `paragraphSpacing`, `firstLineIndent`). Cross-layer contract — extending this file without a read-modify-write wipe the user's theme.

### 2. Signatures

```rust
#[tauri::command]
async fn get_preferences(store: State<'_, PreferencesStore>) -> AppResult<PreferencesResponse>

#[tauri::command]
async fn save_preferences(
    store: State<'_, PreferencesStore>,
    theme: Option<String>,
    font_size: Option<f64>,
    font_family: Option<String>,
    line_height: Option<f64>,
    content_width: Option<f64>,
    page_padding: Option<f64>,
    text_align: Option<String>,
    letter_spacing: Option<f64>,
    paragraph_spacing: Option<f64>,
    first_line_indent: Option<f64>,
) -> AppResult<()>
```

### 3. Contracts

```typescript
interface PreferencesResponse {
  theme: string;             // "light" | "dark" | "system"
  fontSize: number;          // px, 12–32
  fontFamily: string;        // generic or named family; see is_valid_font_family
  lineHeight: number;        // 1.2–2.4
  contentWidth: number;      // em, 28–60
  pagePadding: number;       // rem, 0.5–4
  textAlign: string;         // "start" | "justify"
  letterSpacing: number;     // em, -0.05–0.2
  paragraphSpacing: number;  // em, 0–2
  firstLineIndent: number;   // em, 0–3
}
```

`preferences.json` (schemaVersion stays 1):

```json
{
  "schemaVersion": 1,
  "theme": "light",
  "fontSize": 16,
  "fontFamily": "serif",
  "lineHeight": 1.7,
  "contentWidth": 42,
  "pagePadding": 1.75,
  "textAlign": "start",
  "letterSpacing": 0,
  "paragraphSpacing": 1,
  "firstLineIndent": 0
}
```

- New keys use `#[serde(default)]`. A theme-only v1 file still loads; missing typography keys become the builtin defaults above.
- Dual-read leftover `lineHeight` enums (`compact`/`normal`/`relaxed` → 1.4/1.7/2.0) and leftover `pageMargin` (`narrow`/`normal`/`wide` → 36+1.25 / 42+1.75 / 52+2.5). Already-present `contentWidth` / `pagePadding` win. New writes omit `pageMargin`.
- `ensure_file` must **not** rewrite a valid theme-only file. Rewriting would add keys that older `deny_unknown_fields` builds then treat as corrupt and reset to `theme: light`.
- `save_preferences` is a patch: read current file under the gate, merge only supplied fields, write. At least one field is required. Do not accept a `pageMargin` patch arg.
- Frontend `invoke("save_preferences", { theme, fontSize, fontFamily, lineHeight, contentWidth, pagePadding, textAlign, letterSpacing, paragraphSpacing, firstLineIndent })` uses camelCase. Do not send a theme-only rewrite that drops typography keys.

Book-level overrides of the typography keys live on `ReadingSettings` via `update_reading_state`, not in this file. Theme is global-only.

### 4. Validation & Error Matrix

- empty patch → `InvalidInput` ("At least one preference field is required")
- `theme` not in `light|dark|system` → `InvalidInput` ("Unsupported theme")
- `fontFamily` fails `is_valid_font_family` → `InvalidInput` ("Unsupported fontFamily")
- continuous number not finite or outside its PRD range → `InvalidInput`
- `textAlign` not in `start|justify` → `InvalidInput` ("Unsupported textAlign")
- unreadable / unparseable file on read after init → `StorageIo` / `StorageCorrupt`
- unsupported schema or invalid stored theme/fontFamily/textAlign on init → overwrite with defaults (theme becomes `light`). A **named** `fontFamily` that passes `is_valid_font_family` is supported; do not treat it as corrupt.
- legacy stored `theme: "sepia"` migrates to `light` **on read** (`From<PreferencesDataRaw>` maps it); the file keeps `"sepia"` until the next write. This keeps in-memory data valid so `is_supported()` never triggers the whole-file reset for legacy sepia files. `save_preferences` rejects `"sepia"` on write.

### 5. Good / Base / Bad Cases

- Good: existing `{"schemaVersion":1,"theme":"sepia"}` loads as `light` in memory + typography defaults; file bytes unchanged until the next write.
- Good: `save_preferences({ theme: "dark" })` keeps stored typography numbers / enums.
- Good: leftover `lineHeight: "normal"` + `pageMargin: "wide"` loads as 1.7 / 52 / 2.5 without rewrite.
- Good: stored `fontFamily: "Noto Serif CJK SC"` loads; `ensure_file` does not rewrite the file.
- Base: missing file is created with light + builtin typography defaults. Never writes `pageMargin`.
- Bad: `save_preferences({})` or all-None → `InvalidInput`.
- Bad: `lineHeight: 3.0` → `InvalidInput`.
- Bad: `fontFamily: "Foo; } body {"` → `InvalidInput`.

### 6. Tests Required

- theme-only file loads; theme preserved; file not rewritten
- legacy `theme: "sepia"` loads as `light` in memory; file keeps `"sepia"` until next write
- old enum file migrates on read without rewrite
- theme save does not drop typography keys
- numbers persist; written file omits `pageMargin`
- out-of-range number rejected
- named `fontFamily` accepted; `;` / empty / overlong rejected
- `ensure_file` does not overwrite a v1 file whose `fontFamily` is a named face
- unsupported schema overwritten with defaults

### 7. Wrong vs Correct

#### Wrong

```rust
// Rewrites the whole file from theme only — wipes typography defaults
let data = PreferencesData { schema_version: 1, theme: theme.to_string(), ..Default::default() };
atomic_write(path, &serde_json::to_vec_pretty(&data)?, "preferences.json")?;
```

#### Correct

```rust
let mut data = self.read_unlocked()?;
if let Some(theme) = patch.theme { data.theme = theme; }
if let Some(line_height) = patch.line_height { data.line_height = line_height; }
// ...
self.write_unlocked(&data)?;
```

## Scenario: reader system font family

### 1. Scope / Trigger

- Trigger: settings typography lets the user pick an installed font family for reading body text.
- Cross-layer: `font-kit` → `list_system_fonts` → Settings combobox → `fontFamily` on `save_preferences` / `update_reading_state` → `generateStylesCss` → `view.renderer.setStyles`.

### 2. Signatures

```rust
pub(crate) fn is_valid_font_family(value: &str) -> bool

#[tauri::command]
async fn list_system_fonts() -> AppResult<Vec<String>>
```

`list_system_fonts` runs `SystemSource::all_families()` in `spawn_blocking`. Register it next to `get_preferences`.

### 3. Contracts

- Generics `serif` / `sans-serif` / `monospace` are always valid. Named families: trimmed 1–128 chars, no C0 controls, no `;` `{` `}`. Installation is **not** required on save.
- `list_system_fonts` returns sorted unique family names that pass the validator. It does **not** include the three generics; the frontend prepends them.
- Enumeration failure → `StorageIo`. Empty list is allowed.
- `PreferencesData::is_supported` and `validate_settings` share `is_valid_font_family`. A named face must not look like a corrupt `preferences.json`.
- CSS: generics stay unquoted. Named faces are quoted/escaped and followed by `, serif` so a missing face degrades without rewriting JSON.
- Reader body only. App chrome `font-family` and CSP `font-src` stay unchanged (no `@font-face` file load).

### 4. Validation & Error Matrix

| Condition | Required result |
|-----------|-----------------|
| generic family | accept |
| named family matching the rules, even if uninstalled | accept |
| empty / whitespace-only / >128 chars / `;{}` / C0 | `InvalidInput` |
| `font-kit` listing fails | `StorageIo`; generics still usable |
| named family in an existing v1 file | load as-is; do not rewrite |

### 5. Good/Base/Bad Cases

- **Good**: pick `Noto Serif CJK SC` in the library → new books use it; CSS is `"Noto Serif CJK SC", serif`.
- **Base**: no system fonts returned → combobox still has the three generics.
- **Bad**: keep a 3-value `VALID_FONT_FAMILIES` check in `is_supported` → next launch treats a named face as corrupt and resets theme + typography.

### 6. Tests Required

- Rust: named font saves; injection/empty/overlong rejected; `ensure_file` does not overwrite a named-font prefs file; generics still load.
- Frontend: `cssFontFamily` quotes and appends `, serif`; generics stay bare; `isFontFamily` keeps a valid named value.
- Settings: combobox lists generics first; choosing a name calls `onTypographyChange`; missing current value stays selected and marked unavailable.

### 7. Wrong vs Correct

#### Wrong

```rust
const VALID_FONT_FAMILIES: [&str; 3] = ["serif", "sans-serif", "monospace"];
fn is_supported(&self) -> bool {
    VALID_FONT_FAMILIES.contains(&self.font_family.as_str())
}
// Saved "Noto Serif CJK SC" → ensure_file overwrites preferences.json
```

#### Correct

```rust
if !is_valid_font_family(&font_family) {
    return Err(AppError::invalid_input("Unsupported fontFamily"));
}
```

```ts
font-family: ${cssFontFamily(state.fontFamily)};
// generic → serif
// named  → "Noto Serif CJK SC", serif
```

### Agent Config Commands

**Scope / Trigger**: LLM provider / API key / default model configuration for the embedded agent. Read/write the Litera-owned `<app_data>/agent/` directory.

```rust
#[tauri::command]
async fn get_agent_config(app: AppHandle) -> AppResult<AgentConfigSnapshot>

#[tauri::command]
async fn save_agent_config(app: AppHandle, provider: String, api_key: String, model: String) -> AppResult<()>

#[tauri::command]
async fn set_thinking_level(app: AppHandle, level: String) -> AppResult<()>

#[tauri::command]
async fn add_custom_provider(app: AppHandle, name: String, base_url: String, api_key: String, models: Vec<String>) -> AppResult<CustomProviderEntry>

#[tauri::command]
async fn update_custom_provider(app: AppHandle, provider_id: String, name: String, base_url: String, api_key: String, models: Vec<String>) -> AppResult<CustomProviderEntry>

#[tauri::command]
async fn delete_custom_provider(app: AppHandle, provider_id: String) -> AppResult<()>

#[tauri::command]
async fn switch_provider(app: AppHandle, provider_id: String, model: String) -> AppResult<()>

#[tauri::command]
async fn list_remote_models(app: AppHandle, base_url: String, api_key: String, provider_id: Option<String>) -> AppResult<Vec<String>>
```

```typescript
interface AgentConfigSnapshot {
  configured: boolean;
  provider: string | null;
  model: string | null;
  hasApiKey: boolean;
  customProviders: CustomProviderEntry[];
  thinkingLevel: string;     // global, from settings.json defaultThinkingLevel; "medium" when absent/invalid
}

interface CustomProviderEntry {
  id: string;        // "custom-<8hex>", generated by Rust
  name: string;      // user-supplied display name
  baseUrl: string;
  models: string[];  // every models[].id from models.json
  hasApiKey: boolean;
}
```

**Contracts**:
- `get_agent_config` reads `<app_data>/agent/auth.json` + `settings.json` + `models.json` and returns a masked snapshot (no plaintext key). Custom rows include the full `models` id list (empty ids skipped).
- `save_agent_config` merge-writes: preserves other provider entries in `auth.json` and other fields in `settings.json`, including an existing `defaultThinkingLevel` (only initializes to `"medium"` when the key is absent). Uses the shared `atomic_write` pattern (temp file + persist + sync_parent_dir). Reserved for **built-in** providers (frontend-hardcoded list). `api_key` may be empty **only when `auth.json` already has a key for that provider** — the existing key is kept and auth.json is untouched; otherwise `InvalidInput`.
- Frontend invalidates the cached embedded runtime after config mutations so the next prompt resolves fresh credentials and model configuration.
- The API key MUST NOT appear in logs, journal, or non-`auth.json` files.
- Provider/model selection for built-in providers is a frontend-hardcoded list of common API-key providers (`src/types/agent-config.ts`); model id is free-text.

**Custom OpenAI-compatible providers** (`add_custom_provider` / `update_custom_provider` / `delete_custom_provider` / `switch_provider` / `list_remote_models`):
- `add_custom_provider` generates a `custom-<8hex>` id, writes a provider entry to `<app_data>/agent/models.json` (`{ name, baseUrl, api: "openai-completions", models: [{ id }, ...] }`, **no apiKey** in models.json), and writes the key to `auth.json[<customId>]`. `models` must be non-empty with no blank ids. Does **not** write `settings.json`. Returns the masked entry so the frontend can update its list without a re-fetch.
- `update_custom_provider` edits an existing custom provider: rewrites name/baseUrl/`models` in models.json (preserving the `api` field), upserts `auth.json[<customId>]` **only when `api_key` is non-empty** (empty keeps the existing key). Does **not** write `settings.json`. Activation is exclusively `switch_provider` / `save_agent_config`. Returns the updated masked entry. Rejects ids not starting with `custom-`, unknown ids, empty `models`, or blank model ids (`InvalidInput`).
- `delete_custom_provider` rejects any `provider_id` not starting with `custom-` (guards built-in provider credentials from accidental erasure), removes the models.json + auth.json entries, and clears `defaultProvider`/`defaultModel` in settings.json when the deleted provider was active.
- `switch_provider` merge-writes only `settings.json` (`defaultProvider` + `defaultModel`); it preserves an existing `defaultThinkingLevel` (initializes to `"medium"` only when absent) and never touches `auth.json`. Used for both built-in and custom providers when only the active selection changes (no key update).
- `list_remote_models` is custom OpenAI-compatible only. `GET {trim_end_matches(baseUrl, '/')}/models` with `Authorization: Bearer`, `Accept: application/json`, ~10s timeout, ~1 MiB body cap. If `api_key` is empty and `provider_id` is `custom-*`, read the key from `auth.json`; otherwise empty key is `InvalidInput`. Parse `data[].id` or a top-level string array; drop blanks; de-dupe preserving order. Empty parsed list, HTTP failure, timeout, or oversize body → `InvalidInput` (never include the key). It does not write agent JSON or mutate the active runtime.
- `api` is fixed to `"openai-completions"` and never exposed in the UI.
- The embedded runtime receives a normalized provider configuration from `get_agent_runtime_config` (including `thinkingLevel`); API keys remain Rust-owned outside that request boundary.
- `set_thinking_level` writes only `settings.json` `defaultThinkingLevel` — it does not touch provider/model/auth. The frontend calls it from the ChatInput toolbar Select, then `invalidateConfig()` so the next prompt rebuilds the Agent with the new level. Valid levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; invalid → `InvalidInput`. `clampThinkingLevel` at runtime safely downgrades unsupported levels for the active model.

### Validation & Error Matrix

| Condition | Error |
|-----------|-------|
| User cancels file picker | `{ code: "Cancelled", ... }` — frontend ignores only this code |
| User cancels overwrite confirm | not an error — call `discard_import`; missing pending file is success |
| `import_paths` non-epub / symlink / non-file | `{ code: "InvalidInput", ... }` |
| Invalid ID/path/fraction/settings/import token / contentHash | `{ code: "InvalidInput", ... }` |
| Stale `contentVersion` after a committed re-import | `{ code: "InvalidInput", ... }` |
| Book not found before any file mutation | `{ code: "BookNotFound", ... }` |
| Invalid JSON/schema/record fields/controlled paths | `{ code: "StorageCorrupt", ... }` |
| File read/write/sync/rename failure | `{ code: "StorageIo", ... }` |
| Failed compensating restore | `{ code: "RollbackFailed", ... }` |
| `add`/`update` custom provider with empty `models` or a blank model id | `{ code: "InvalidInput", ... }` |
| `list_remote_models` empty `base_url`, or empty `api_key` with no stored `custom-*` key | `{ code: "InvalidInput", ... }` |
| `list_remote_models` HTTP/timeout/oversize/empty parsed list | `{ code: "InvalidInput", ... }` — message must not contain the API key |

### Good/Base/Bad Cases

- **Good**: Import epub with cover → grid shows cover, title, author; reopen app → book persists
- **Base**: Import epub without cover → grid shows placeholder (first char of title)
- **Bad**: Re-import same file, then metadata extraction fails → old EPUB/title/author/cover remain active; staged bytes never partially replace them
- **Good**: Same path, same bytes → `duplicate`; no pending file; title / progress / committed EPUB unchanged
- **Good**: Same path, different bytes → `overwrite`; user confirms → progress/sessions kept
- **Good**: Different path, same bytes → `duplicate`; library count unchanged
- **Bad**: Classify a whole picker batch, then confirm overwrite, then treat a later file with the new bytes as `new` (hash not committed yet)
- **Bad**: Compare hashes before backfill — a record missing `contentHash` is treated as `overwrite` even when the stored EPUB matches

### Tests Required

- **Atomic library writes**: inject a write failure and assert the prior `library.json` bytes remain complete and parseable.
- **Concurrent partial updates**: race fraction and settings updates, then assert the final record contains both values.
- **Import commit boundary**: stage changed bytes for an existing book, fail metadata/library commit, and assert EPUB, metadata, and cover all remain on the previous version.
- **Crash recovery**: leave a prepared import journal and a staged deletion on disk, reinitialize `LibraryStore`, and assert the uncommitted import is rolled back while the referenced deleted directory is restored.
- **Path safety**: reject traversal-like IDs, forged stored paths, duplicate IDs, symlink book/session directories, and non-regular EPUB/cover files before mutation. Replace `.trash` with a symlink after initialization and assert delete fails while the canonical book and outside directory remain unchanged.
- **Frontend lifecycle**: assert debounce keeps the latest call, `flush()` waits and propagates failures, and repeated `cancel()` is safe under StrictMode cleanup.
- **Import status**: same-path same-bytes returns `duplicate` with no `importId` and no `.imports` file; same-path different-bytes returns `overwrite` and does not replace EPUB until `save_book_metadata`; cancel + `discard_import` leaves the previous version; same-bytes different path returns `duplicate` with no new record.
- **Open title / sort**: `get_book_open_context.title` equals the stored title; after a successful `open_book_bytes`, that book sorts first in `list_books`.
- **Delete sessions**: `delete_book` removes `sessions/<bookId>/`; missing dir still succeeds.
- **Agent config models array**: `get_agent_config` returns every `models[].id`; `update_custom_provider` with two ids writes both and leaves `settings.json` unchanged even when that provider is active.
- **Remote model parse**: `data[].id` and a top-level string array both succeed; blank ids dropped; empty result is `InvalidInput`.
- **Remote model key resolve**: empty `api_key` + stored `custom-*` key succeeds without writing files; empty key and no `provider_id` is `InvalidInput`.

### Storage and path rules

- Every `library.json` read/modify/write and every related file transition is inside the shared `LibraryStore` gate.
- `library.json` writes use a same-directory temporary file, flush + `sync_all`, atomic persist, and parent-directory sync. Post-persist failures restore the prior complete bytes.
- Stored `filePath` must equal `<appData>/books/<bookId>/book.epub`; non-empty `coverPath` must equal `<appData>/books/<bookId>/cover.jpg` or `<appData>/books/<bookId>/cover.png` (legacy). Commands derive operational paths again from the trusted root and never follow stored paths.
- `books`, `.trash`, `sessions`, book directories, `.imports`, and `.transactions` must be real directories, not symlinks. EPUB/cover/transaction files must be regular files. Fresh initialization and legacy reset both create the real `sessions` root before agent use.
- Delete revalidates `.trash` immediately before renaming the book directory into it, then commits metadata. A write failure renames it back; startup also restores an interrupted pre-commit staged deletion. Committed trash is retained for an explicit future retention policy.
- Startup moves an unregistered real book directory (for example, a crash during first import before `library.json` commit) into `.trash/orphan-*`; it rejects unregistered files and symlinks instead of following them.
- All synchronous dialog and filesystem work runs inside `spawn_blocking`; library commands are async.

### Wrong vs Correct

#### Wrong — same-path hash match still requires overwrite
```rust
// Skips the book that owns this path, so unchanged reopen is overwrite
book.id != book_id && book.content_hash.as_deref() == Some(incoming_hash.as_str())
```

#### Correct — any contentHash match is duplicate, including self
```rust
// After backfill_missing_content_hashes
book.content_hash.as_deref() == Some(incoming_hash.as_str())
// same path + different hash still falls through to overwrite
```

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

#### Wrong — fail the open if lastOpenedAt cannot be written
```rust
let bytes = store.read_book_bytes(...)?;
store.mark_book_opened(&book_id)?; // a shelf-sort metadata error hides valid bytes
```

#### Correct — lastOpenedAt is best-effort after a valid byte read
```rust
let bytes = store.read_book_bytes(...)?;
if let Err(error) = store.mark_book_opened(&book_id) {
    eprintln!("[library] Book opened but lastOpenedAt was not saved: {error}");
}
```

#### Wrong — switch provider on dropdown change
```ts
// Selecting a custom provider immediately writes live settings
onValueChange={(id) => { void switchProvider(id, model); }}
```

#### Correct — dropdown is draft; one apply writes
```ts
// Select only updates form state. Apply updates the provider definition and then
// switches it, or calls save_agent_config for built-ins; runtime cache invalidates once.
onValueChange={(id) => { setProvider(id); }}
```

#### Wrong — `update_custom_provider` also writes `defaultModel`
```rust
// Side-effect activation: editing an unused custom provider changes the live model
if is_active { settings["defaultModel"] = models[0]; }
```

#### Correct — update writes definition only
```rust
// models.json + optional auth.json. Activation is switch_provider / save_agent_config.
```

#### Wrong — WebView fetches `/models` with the API key
```ts
await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
```

#### Correct — Rust `list_remote_models`
```ts
await invoke<string[]>("list_remote_models", { baseUrl, apiKey, providerId });
```

---

## File Dialog Commands

### Gotcha: blocking dialog in sync command causes deadlock

> **Warning**: Tauri v2 non-async commands run on the main thread. `blocking_pick_file()` needs the main thread to show the dialog → deadlock. See `error-handling.md` for full details.
>
> **Rule**: Any command calling `blocking_*` dialog APIs or sync blocking I/O must be `async fn` with `spawn_blocking` for the blocking part.

The legacy `open_file` command is removed. `import_book` is the only file-dialog entry point, and all EPUB bytes cross IPC through the Raw commands above.

---

## Capability Boundary

- The WebView capability contains only `core:default`; it cannot invoke shell
  spawn/execute, native dialog, or opener commands.
- Rust owns native file dialogs and OS-open integration. The embedded Agent runs
  in the WebView and receives only normalized book data plus request-scoped
  provider configuration.
- Do not add `shell:*`, `dialog:*`, or `opener:*` WebView permissions unless a
  reviewed frontend feature actually invokes them with a narrow scope.
