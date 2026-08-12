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
└── sessions/<bookId>/   # sidecar-managed content under a LibraryStore-validated root
```

**bookId generation**: `DefaultHasher` hash of the **source file path** (not the app data copy path). Same source file maps to the same record. Each import also receives an unpredictable UUID `importId` that binds frontend-extracted metadata and staged Raw IPC access to the exact bytes.

**Repeat-import transaction**: `import_book` reads the selected EPUB once and stages those exact bytes without replacing the current EPUB. `save_book_metadata(importId)` creates a persistent rollback journal, switches EPUB/cover, and atomically commits metadata plus an internal `contentVersion` in `library.json`. A parse/save failure leaves the previous complete version active. Startup restores a prepared transaction when `contentVersion` did not commit, and keeps the new version when it did.

**Serialization boundary**: all commands return serializable `{ code, message }` errors. Frontend cancellation handling checks `code === "Cancelled"`; storage failures must be rendered to the user rather than silently converted to an empty library.

**Cover display**: Frontend uses `convertFileSrc(coverPath)` from `@tauri-apps/api/core` to render covers via Tauri's asset protocol. Requires:
- `tauri.conf.json` → `app.security.assetProtocol.enable = true` + `scope = ["$APPDATA/books/**"]`
- `tauri` Cargo dependency with `features = ["protocol-asset"]`
- CSP `img-src` must include `asset:` and `http://asset.localhost`

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
- **Path safety**: reject traversal-like IDs, forged stored paths, duplicate IDs, symlink book/session directories, and non-regular EPUB/cover files before mutation. Replace `.trash` with a symlink after initialization and assert delete fails while the canonical book and outside directory remain unchanged.
- **Frontend lifecycle**: assert debounce keeps the latest call, `flush()` waits and propagates failures, and repeated `cancel()` is safe under StrictMode cleanup.

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
fn agent_prompt(prompt, selection?, chapter_index?, book_id, request_id?, prompt_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
fn agent_edit_prompt(message_index, prompt, selection?, chapter_index?, book_id, request_id?, prompt_id?, State<SidecarSupervisor>) -> Result<CommandReceipt, String>
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
    chapter_index: Option<u32>,
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
