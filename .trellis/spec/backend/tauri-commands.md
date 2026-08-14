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
  lastOpenedAt?: string;  // RFC3339; missing = never opened
  contentHash?: string;   // SHA-256 hex of committed EPUB bytes
}

interface ReadingSettings {
  fontSize?: number;           // px, 12–32
  fontFamily?: string;         // "serif" | "sans-serif" | "monospace"
  theme?: string;              // "light" | "dark" | "sepia" — accepted for old files, not written
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
└── sessions/<bookId>/   # sidecar-managed content under a LibraryStore-validated root
```

**bookId generation**: `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record. Content identity is a separate SHA-256 of EPUB bytes (`contentHash`). Do not change `bookId` to a content hash.

**Import classification** (before or instead of staging):
- `duplicate` — another book already has this `contentHash`. Do not stage. Return that book's `bookId` + `title`.
- `overwrite` — same path `bookId` exists. Stage pending bytes only. Frontend must confirm, then `save_book_metadata`, or `discard_import`.
- `new` — stage and insert the record as before.

`save_book_metadata` writes `contentHash` from the staged bytes. An overwrite must keep `lastFraction`, `settings`, and `lastOpenedAt`.

**list_books order**: `lastOpenedAt` descending (missing last), then `importedAt` descending. Frontend search filters; it does not re-sort.

**Open context / last opened**: `get_book_open_context` returns `title` and backfills a missing `contentHash` from the stored EPUB under the store lock. `open_book_bytes` notifies the sidecar first; writing `lastOpenedAt` after that is best-effort (log on failure, do not fail the open).

**Repeat-import transaction**: `import_book` / `import_paths` read EPUB bytes and stage them without replacing the current EPUB until `save_book_metadata(importId)`. A parse/save failure leaves the previous complete version active. Startup restores a prepared transaction when `contentVersion` did not commit, and keeps the new version when it did.

**Delete**: after the existing trash + `library.json` commit, `delete_book` removes `sessions/<bookId>/`. Missing session dir is success. If session removal fails after the book record is gone, return `StorageIo` and do not roll the book back.

**Drag-drop paths**: `import_paths` accepts only OS drop / picker-equivalent absolute paths. Reject non-`.epub`, symlinks, and non-regular files. Do not add `dialog` / `fs` / `opener` permissions to the WebView capability.

**OS file open**: system "Open With" / double-click is a third path source. It must reuse `import_paths` after `take_pending_open_paths`. See "Scenario: OS EPUB open" below.

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
  - Windows / Linux hot start: `tauri-plugin-single-instance` callback `(app, args, cwd)` — first registered plugin, then focus `main`.
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

### 5. Good/Base/Bad Cases

- **Good**: cold-start a new `.epub` → imported and reader opens that book.
- **Base**: app already running → existing window focuses, imports, opens last success; no second process.
- **Bad**: emit path lists and also leave them in the queue → cold start double-imports and hits overwrite.

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
  theme: string;             // "light" | "dark" | "sepia"
  fontSize: number;          // px, 12–32
  fontFamily: string;        // "serif" | "sans-serif" | "monospace"
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
- `theme` not in `light|dark|sepia` → `InvalidInput` ("Unsupported theme")
- `fontFamily` not in `serif|sans-serif|monospace` → `InvalidInput` ("Unsupported fontFamily")
- continuous number not finite or outside its PRD range → `InvalidInput`
- `textAlign` not in `start|justify` → `InvalidInput` ("Unsupported textAlign")
- unreadable / unparseable file on read after init → `StorageIo` / `StorageCorrupt`
- unsupported schema or invalid stored theme/fontFamily/textAlign on init → overwrite with defaults (theme becomes `light`)

### 5. Good / Base / Bad Cases

- Good: existing `{"schemaVersion":1,"theme":"sepia"}` loads as sepia + typography defaults; file bytes unchanged.
- Good: `save_preferences({ theme: "dark" })` keeps stored typography numbers / enums.
- Good: leftover `lineHeight: "normal"` + `pageMargin: "wide"` loads as 1.7 / 52 / 2.5 without rewrite.
- Base: missing file is created with light + builtin typography defaults. Never writes `pageMargin`.
- Bad: `save_preferences({})` or all-None → `InvalidInput`.
- Bad: `lineHeight: 3.0` → `InvalidInput`.

### 6. Tests Required

- theme-only file loads; theme preserved; file not rewritten
- old enum file migrates on read without rewrite
- theme save does not drop typography keys
- numbers persist; written file omits `pageMargin`
- out-of-range number rejected
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

### Agent Config Commands

**Scope / Trigger**: LLM provider / API key / default model configuration for the sidecar agent. Read/write the Litera-owned `<app_data>/agent/` directory (see quality-guidelines "sidecar agent config is injected").

```rust
#[tauri::command]
async fn get_agent_config(app: AppHandle) -> AppResult<AgentConfigSnapshot>

#[tauri::command]
async fn save_agent_config(app: AppHandle, provider: String, api_key: String, model: String) -> AppResult<()

#[tauri::command]
async fn add_custom_provider(app: AppHandle, name: String, base_url: String, api_key: String, model: String) -> AppResult<CustomProviderEntry>

#[tauri::command]
async fn update_custom_provider(app: AppHandle, provider_id: String, name: String, base_url: String, api_key: String, model: String) -> AppResult<CustomProviderEntry>

#[tauri::command]
async fn delete_custom_provider(app: AppHandle, provider_id: String) -> AppResult<()>

#[tauri::command]
async fn switch_provider(app: AppHandle, provider_id: String, model: String) -> AppResult<()>
```

```typescript
interface AgentConfigSnapshot {
  configured: boolean;
  provider: string | null;
  model: string | null;
  hasApiKey: boolean;
  customProviders: CustomProviderEntry[];
}

interface CustomProviderEntry {
  id: string;        // "custom-<8hex>", generated by Rust
  name: string;      // user-supplied display name
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
```

**Contracts**:
- `get_agent_config` reads `<app_data>/agent/auth.json` + `settings.json` + `models.json` and returns a masked snapshot (no plaintext key).
- `save_agent_config` merge-writes: preserves other provider entries in `auth.json` and other fields in `settings.json`. Uses the shared `atomic_write` pattern (temp file + persist + sync_parent_dir). Reserved for **built-in** providers (frontend-hardcoded list). `api_key` may be empty **only when `auth.json` already has a key for that provider** — the existing key is kept and auth.json is untouched; otherwise `InvalidInput`.
- Frontend calls `restart_sidecar` after `save_agent_config` / `switch_provider` so the sidecar re-reads config on next `configure` + session creation.
- The API key MUST NOT appear in logs, journal, or non-`auth.json` files.
- Provider/model selection for built-in providers is a frontend-hardcoded list of common api_key providers (`src/types/agent-config.ts`); model id is free-text. This avoids coupling the UI to the pi-ai built-in catalog (which only exists inside the sidecar Node process).

**Custom OpenAI-compatible providers** (`add_custom_provider` / `update_custom_provider` / `delete_custom_provider` / `switch_provider`):
- `add_custom_provider` generates a `custom-<8hex>` id, writes a provider entry to `<app_data>/agent/models.json` (`{ name, baseUrl, api: "openai-completions", models: [{ id: model }] }`, **no apiKey** in models.json), and writes the key to `auth.json[<customId>]`. Returns the masked entry so the frontend can update its list without a re-fetch.
- `update_custom_provider` edits an existing custom provider: updates name/baseUrl/model in models.json (preserving the `api` field), upserts `auth.json[<customId>]` **only when `api_key` is non-empty** (empty keeps the existing key), and updates `settings.json` `defaultModel` when the edited provider is the active one. Returns the updated masked entry. Rejects ids not starting with `custom-` and unknown ids (`InvalidInput`).
- `delete_custom_provider` rejects any `provider_id` not starting with `custom-` (guards built-in provider credentials from accidental erasure), removes the models.json + auth.json entries, and clears `defaultProvider`/`defaultModel` in settings.json when the deleted provider was active.
- `switch_provider` merge-writes only `settings.json` (`defaultProvider` + `defaultModel` + `defaultThinkingLevel: "medium"`); it never touches `auth.json`. Used for both built-in and custom providers when only the active selection changes (no key update).
- `api` is fixed to `"openai-completions"` and never exposed in the UI.
- The sidecar reads `models.json` via pi-coding-agent's `ModelConfig.load`; the sidecar/protocol layer is unaware of custom providers.

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

### Good/Base/Bad Cases

- **Good**: Import epub with cover → grid shows cover, title, author; reopen app → book persists
- **Base**: Import epub without cover → grid shows placeholder (first char of title)
- **Bad**: Re-import same file, then metadata extraction fails → old EPUB/title/author/cover remain active; staged bytes never partially replace them
- **Good**: Same path re-import → `overwrite`; user confirms → progress/sessions kept
- **Good**: Different path, same bytes → `duplicate`; library count unchanged
- **Bad**: Classify a whole picker batch, then confirm overwrite, then treat a later file with the new bytes as `new` (hash not committed yet)

### Tests Required

- **Atomic library writes**: inject a write failure and assert the prior `library.json` bytes remain complete and parseable.
- **Concurrent partial updates**: race fraction and settings updates, then assert the final record contains both values.
- **Import commit boundary**: stage changed bytes for an existing book, fail metadata/library commit, and assert EPUB, metadata, and cover all remain on the previous version.
- **Crash recovery**: leave a prepared import journal and a staged deletion on disk, reinitialize `LibraryStore`, and assert the uncommitted import is rolled back while the referenced deleted directory is restored.
- **Path safety**: reject traversal-like IDs, forged stored paths, duplicate IDs, symlink book/session directories, and non-regular EPUB/cover files before mutation. Replace `.trash` with a symlink after initialization and assert delete fails while the canonical book and outside directory remain unchanged.
- **Frontend lifecycle**: assert debounce keeps the latest call, `flush()` waits and propagates failures, and repeated `cancel()` is safe under StrictMode cleanup.
- **Import status**: same-path import returns `overwrite` and does not replace EPUB until `save_book_metadata`; cancel + `discard_import` leaves the previous version; same-bytes different path returns `duplicate` with no new record.
- **Open title / sort**: `get_book_open_context.title` equals the stored title; after a successful `open_book_bytes`, that book sorts first in `list_books`.
- **Delete sessions**: `delete_book` removes `sessions/<bookId>/`; missing dir still succeeds.

### Storage and path rules

- Every `library.json` read/modify/write and every related file transition is inside the shared `LibraryStore` gate.
- `library.json` writes use a same-directory temporary file, flush + `sync_all`, atomic persist, and parent-directory sync. Post-persist failures restore the prior complete bytes.
- Stored `filePath` must equal `<appData>/books/<bookId>/book.epub`; non-empty `coverPath` must equal `<appData>/books/<bookId>/cover.png`. Commands derive operational paths again from the trusted root and never follow stored paths.
- `books`, `.trash`, `sessions`, book directories, `.imports`, and `.transactions` must be real directories, not symlinks. EPUB/cover/transaction files must be regular files. Fresh initialization and legacy reset both create the real `sessions` root before the sidecar starts.
- Delete revalidates `.trash` immediately before renaming the book directory into it, then commits metadata. A write failure renames it back; startup also restores an interrupted pre-commit staged deletion. Committed trash is retained for an explicit future retention policy.
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

#### Wrong — fail the open if lastOpenedAt cannot be written
```rust
notify_sidecar_book_opened(...)?;
store.mark_book_opened(&book_id)?; // sidecar already switched; UI would stay on library
```

#### Correct — lastOpenedAt is best-effort after sidecar accept
```rust
notify_sidecar_book_opened(...)?;
if let Err(error) = store.mark_book_opened(&book_id) {
    eprintln!("[library] Book opened but lastOpenedAt was not saved: {error}");
}
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

### 1. Scope / Trigger

Apply this contract whenever an Agent command, sidecar protocol field, supervisor state, or reader/Agent book transition changes. It prevents a Tauri invoke receipt, Node state, and React UI from describing different active operations.

### 2. Signatures

```rust
fn get_agent_snapshot(State<SidecarSupervisor>) -> Result<AgentSnapshot, String>
fn agent_prompt(prompt, selection?, chapter_href?, book_id, request_id?, prompt_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn agent_edit_prompt(message_index, prompt, selection?, chapter_href?, book_id, request_id?, prompt_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn agent_abort(prompt_id?, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn list_sessions(book_id, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn new_session(book_id, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn switch_session(book_id, session_id, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn delete_session(book_id, session_id, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn close_book(book_id?, request_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn restart_sidecar(State<SidecarSupervisor>) -> Result<(), String>
```

### 3. Contracts

- Agent commands enqueue a validated `protocolVersion: 1` discriminated union. They never write or flush child stdin on the Tauri command thread.
- `CommandReceipt` is `{ requestId, promptId? }`. A receipt for normal Agent commands means the bounded supervisor queue accepted the command; correlated `agent_event` success/error completes the operation.
- `get_agent_snapshot` is an immediate clone of `{ version, generation, status, bookId?, sessionId?, promptId?, error? }`. React registers the single `agent_event` listener before reading it.
- `open_book_bytes` is stricter: after the version-bound Raw EPUB read, a blocking worker waits for the supervisor actor to accept `open_book` into the child-writer queue. Only then may EPUB bytes return.
- Replay state is committed only after writer-queue acceptance. A book-specific `close_book` clears replay state only when its ID matches the replay book.

### Convention: sidecar book_opened notification

`open_book_bytes` notifies the supervisor with the controlled EPUB path + bookId + sessionsDir only after the version-bound read succeeds. Runtime callers never supply a filesystem path. Resolving the sessions directory, supervisor enqueue, actor processing, or child-writer enqueue failure returns a visible `AppError`; EPUB bytes are not returned, so Reader and Agent cannot half-switch. The WebView can only close a current book; it cannot submit arbitrary paths.

### 4. Validation & Error Matrix

| Condition | Required result |
|-----------|-----------------|
| Unsupported protocol version, empty/oversized ID, prompt, selection, path, or JSONL frame | Reject before returning a receipt |
| Supervisor or child-writer queue full/disconnected | Return an invoke error or emit the command-correlated transport error; never block the Tauri command thread |
| `open_book` child-writer enqueue fails | `open_book_bytes` returns `StorageIo`; Reader does not switch |
| Invalid/unknown sidecar stdout event | Terminate that generation and enter bounded recovery |
| Duplicate/regressing `seq` or old process generation | Drop before snapshot/UI mutation |
| Prompt/book correlation does not match current state | Advance the global event version but do not mutate operation state |
| Sidecar restarts during a prompt | Emit interruption, recover book/session only, never replay the prompt |

### 5. Good/Base/Bad Cases

- **Good**: open B while A is active → B writer enqueue is confirmed, A generation is invalidated, B worker loads, and only `book_ready(B)` enables input.
- **Base**: enqueue a prompt → invoke returns its IDs; `prompt_started` establishes session correlation and deltas/end update only that prompt.
- **Bad**: update replay book before writer enqueue, return EPUB bytes, then discover the writer queue was full; Reader would show B while Agent still serves A.

### 6. Tests Required

- Rust protocol fixture round-trip plus invalid version/seq/nested ID/frame-size rejection.
- Supervisor tests for command correlation, confirmed open writer result, full writer kill preemption, invalid stdout termination, restart budget, and stale snapshot errors.
- Node tests for bounded dispatcher/output backpressure, abort tombstones, superseding workers, and real A/B EPUB generation isolation.
- React reducer tests for reverse list responses, stale book/prompt errors, prompt/session correlation, toolCallId matching, first-prompt session creation, `session_rewound` same-book replace / cross-book ignore, and listen/snapshot cleanup order.
- Empty-PATH sidecar smoke and `tauri build --no-bundle` remain release gates.

### 7. Wrong vs Correct

#### Wrong

```rust
supervisor.send(open_book_b)?;
Ok(raw_response(bytes_b))
```

### Capability Boundary

- The WebView capability contains only `core:default`; it cannot invoke shell spawn/execute, native dialog, or opener commands.
- Rust owns both privileged integrations: the fixed external sidecar is resolved internally, and `import_book` opens the native EPUB picker through the Rust dialog plugin.
- Do not add `shell:*`, `dialog:*`, or `opener:*` WebView permissions unless a reviewed frontend feature actually invokes them and narrows their scope.

#### Correct

```rust
run_blocking(move || supervisor.send_confirmed(open_book_b)).await?;
Ok(raw_response(bytes_b))
```

## Scenario: edit a visible user message (`agent_edit_prompt`)

### 1. Scope / Trigger

Editing a chat user message must rewind the **current session file** and resend. Do not add an optional index to `prompt`. Do not `fork()` a new session file. Do not create a session from this command.

### 2. Signatures

```rust
fn agent_edit_prompt(
    message_index: u32,
    prompt: String,
    selection: Option<String>,
    chapter_href: Option<String>,
    book_id: String,
    request_id: Option<String>,
    prompt_id: Option<String>,
    supervisor: State<SidecarSupervisor>,
) -> Result<CommandReceipt, String>
```

Sidecar command: `{ type: "edit_prompt", requestId, promptId, bookId, messageIndex, text, context? }`.
Sidecar event: `{ type: "session_rewound", requestId?, bookId, sessionId, promptId, messages }`.

### 3. Contracts

- `messageIndex` is the index in the **visible** user+assistant list (`serializeMessages` / current `getBranch()`), not `getEntries()` and not `getUserMessagesForForking()`. `getBranch()` is already chronological (root → leaf); do not reverse before indexing.
- `session_rewound.messages` is the truncated visible list **before** the new user message. Frontend reducer replaces `messages` without clearing this turn's `promptId`; `use-agent-bridge` then dispatches `user_message`.
- Rewind uses `AgentSession.navigateTree(targetId)`, which syncs `agent.state.messages`. Bare `sessionManager.branch()` does not.
- If the target user entry's parent is `customType: "readingContext"`, navigate that parent so the old aside leaves the path. Keep `bookSnapshot`.
- After rewind, reuse `startPrompt` (snapshot aside if missing, then reading-context aside, then `session.prompt(text)`). Never concatenate context into `text`.
- Requires an existing current session for this book. Rejects when another prompt is active.

### 4. Validation & Error Matrix

| Condition | Required result |
|-----------|-----------------|
| No current session / session not this book | Invoke/sidecar error; no rewind |
| `messageIndex` missing, not user, or off the current branch | Error; history unchanged |
| Another prompt is active / sidecar `isStreaming` | Error; do not `navigateTree` |
| Empty or oversized `text` / selection | Reject in protocol decode before a receipt |
| `navigateTree` returns `cancelled` | Error; do not emit `session_rewound` |

### 5. Good/Base/Bad Cases

- **Good**: edit user message 0 of `[user, assistant, user, assistant]` → leaf moves to before that user (and its readingContext) → UI shows `[]` then the new user → stream.
- **Base**: edit the last user message → later assistant disappears; new prompt starts.
- **Bad**: `sessionManager.branch(userId)` only → JSONL leaf moves but `session.messages` still has the old tail; next `prompt()` desyncs file and model context.

### 6. Tests Required

- Shared `protocol/agent-protocol.jsonl` fixtures for `edit_prompt` and `session_rewound`.
- Reducer: same-book `session_rewound` replaces messages and keeps `promptId`; other book ignored.
- Bridge: `editPrompt` does not invoke when status !== `bookReady`; `session_rewound` then appends the pending user message.

### 7. Wrong vs Correct

#### Wrong

```typescript
managed.session.sessionManager.branch(userEntry.id);
await managed.session.prompt(text); // agent.state.messages still has the old tail
```

#### Correct

```typescript
const navigateId = isReadingContextParent(managed, target.parentId) && target.parentId
  ? target.parentId
  : target.id;
await managed.session.navigateTree(navigateId);
sendEvent({ type: "session_rewound", messages: serializeMessages(managed.session.messages), ... });
await startPrompt(managed, prompt, text, context);
```
