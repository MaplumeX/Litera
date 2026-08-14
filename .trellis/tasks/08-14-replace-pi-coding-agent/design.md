# Design: Embedded Pi Agent Runtime

## 1. Architecture

Target data flow:

```text
ChatPanel
  -> useAgentRuntime (local controller + pure reducer)
  -> LiteraAgentRuntime
       -> pi-agent-core Agent
       -> pi-ai provider stream
       -> guarded Tauri native fetch
       -> BookContentPort -> module Web Worker
       -> SessionPort -> typed Tauri commands -> Rust PiSessionStore
```

The Web Worker performs EPUB extraction, TOC ownership, chapter windowing, and
search. It is a WebView worker thread bundled by Vite, not a Tauri external
binary or separately managed process.

Rust no longer participates in streaming Agent events. It remains responsible
for controlled filesystem access, active provider configuration, credentials,
session persistence, old-session migration, and deletion with the owning book.

## 2. Frontend runtime boundary

Create `src/agent/` with four boundaries:

- `runtime/`: owns one `Agent` per active session, prompt/abort/edit sequencing,
  model construction, event normalization, and context-window hydration.
- `book/`: typed `BookContentPort`, Vite module-worker client, browser-safe EPUB
  unzip/parser, TOC-owned chapter helpers, and search.
- `sessions/`: typed invoke adapter for Rust JSONL commands plus Pi v3 header,
  tree, active-branch, compaction, and `AgentMessage` projection.
- `transport/`: wraps Tauri native fetch. It rejects non-HTTP(S) URLs and any
  origin not equal to the active provider base URL before sending credentials.

`useAgentBridge` is replaced by (or internally delegates to) `useAgentRuntime`,
while keeping the `ChatPanel` action shape stable where practical. The runtime
emits a local typed event union with `revision`, `bookId`, `sessionId`,
`promptId`, and `toolCallId`. The pure reducer keeps correlation filtering, but
removes sidecar-only `protocolVersion`, `generation`, `ready`, `restarting`,
`supervisor_status`, and snapshot replay concepts.

Runtime states become `idle | loadingBook | bookReady | prompting | error`.
Changing books aborts the current prompt, terminates the old book worker, drops
in-memory Pi instances, then opens the new book. A runtime error only disables
Agent actions; it never unmounts or blocks the reader.

## 3. Pi integration

Pin matching versions of `@earendil-works/pi-ai` and
`@earendil-works/pi-agent-core`. Import only the provider/runtime paths proven
by the browser spike; do not import coding-agent config/session/resource code.

For each session:

1. Load the Pi v3 entries and current leaf from Rust.
2. Build the active branch using Pi's `parentId` and compaction rules, then keep
   at most the most recent 12 complete turns for the live Agent while preserving
   paired assistant tool calls and `toolResult` messages.
3. Construct an `Agent` with the reading system prompt, active model, book tools,
   and injected stream function/native transport.
4. Subscribe once and normalize Pi events into Litera reducer events.
5. Before the network call, append a Pi `message` entry containing the raw user
   `AgentMessage`. Keep stream deltas in memory. At Agent settlement, append the
   newly completed assistant/tool-result `AgentMessage` entries in order. A
   graceful abort persists the terminal assistant message with
   `stopReason: "aborted"`; a process crash may lose the unfinished partial reply,
   matching Pi's existing persistence behavior.

Editing a user message sets the next appended user's `parentId` to the edited
entry's parent (or `null` for the root). No branch-move row is written: the last
appended entry is the persisted active leaf, exactly as in Pi. Old entries remain
as an alternate branch. The projection follows the new leaf to root and rebuilds
Pi from the windowed active branch.

## 4. Pi v3 JSONL schema and Rust store

Keep the existing location:

```text
<app_data>/sessions/<bookId>/<session-file>.jsonl
```

The first line remains Pi's header:

```json
{"type":"session","version":3,"id":"<uuid>","timestamp":"<ISO>","cwd":"<path>"}
```

Every later entry keeps Pi's `type`, unique `id`, `parentId`, and ISO timestamp.
Litera writes the documented v3 entry kinds instead of inventing a second
taxonomy:

- `message` with a `pi-agent-core` `AgentMessage` (`user`, `assistant`, or
  `toolResult`);
- `session_info` for rename/clear-title;
- `custom_message` for persisted book snapshot/reading context;
- `model_change` when the active provider/model changes within a session;
- existing `compaction`, `branch_summary`, `custom`, `label`, and
  `thinking_level_change` rows are preserved and replayed/skipped according to
  Pi v3 semantics, even when Litera does not create them.

No API key is persisted. Assistant provider/model/usage/stopReason and visible
thinking/tool-call content remain part of Pi `AgentMessage`, because removing
them would break v3 compatibility. Provider raw HTTP responses and runtime class
instances are never stored.

Rust validates the structural envelope, line/file byte caps, header version,
ids, timestamps, parent existence, path containment, and append preconditions.
The frontend's single Pi-entry decoder validates message/content payloads and
builds the UI/context projection; rendering code never casts raw entries itself.
Header versions above 3 fail explicitly until supported. v1/v2 use Pi's
documented migrations (linear ids/parents, then `hookMessage` → `custom`) with a
backup plus atomic rewrite.

Each append is serialized per session, writes complete newline-terminated Pi
entries, flushes them, and never modifies prior bytes during normal interaction.
Creation and v1/v2 migration use temporary file + atomic rename. A partial final
line after power loss is recoverable only when every previous line is valid; no
earlier corruption is ignored.

Commands:

- `list_agent_sessions(bookId)` lists the existing Pi files and projects the
  latest `session_info` or first user message.
- `load_agent_session(bookId, sessionId)` returns decoded v3 entries, current
  leaf (last appended tree entry), and the visible active-branch projection.
- `append_agent_session_entries(bookId, sessionId, expectedLeafId, entries)`
  validates and appends a bounded Pi-compatible batch under the per-session
  gate; stale-leaf compare-and-append fails instead of allowing two writers.
- `create_agent_session(bookId)` writes a valid header-only Pi v3 file.
- `delete_agent_session(bookId, sessionId)` removes only the validated file.

Rename appends `session_info`. Header-only empty sessions are schema-compatible
and may be persisted immediately, removing the old optimistic UI exception.

## 5. Compatibility and rollback

There is no cross-schema or cross-directory migration. Current v3 files are read
and appended in place. v1/v2 upgrades follow Pi's published migration and create
a recoverable backup before atomic replacement. Malformed files fail per session
without hiding other valid sessions.

Because new writes remain Pi v3-compatible, rollback to the old sidecar can read
sessions created or extended by the embedded runtime. Tests must open the new
writer's fixtures with the pinned legacy `SessionManager`, and open legacy
fixtures with the new reader. Deleting a book continues to remove the one shared
session root.

## 6. Book worker and tools

On book open, pass a copied/transfer-safe EPUB `ArrayBuffer` to a Vite module
worker. Port the pure chapter ownership, href matching, context formatting,
windowing, query cleanup, hit merging, and limits from the sidecar.

Replace Node `adm-zip`, `node:path`, worker_threads, and FTS5 with browser-safe
unzip plus a deterministic in-memory trigram candidate index. Exact matching
still wins; partial matching uses candidate chapters then the existing token
threshold. Search/index work remains off the UI thread.

The tool surface and result contracts stay stable:

- `read_chapter({chapterIndex, part})`
- `search_in_book({queries})`
- `get_book_metadata()`
- `get_toc()`

All use the same TOC-owned chapter list. The live reader sends `chapterHref`,
which is resolved internally; hrefs are never exposed to the model.

## 7. Configuration, credentials, and networking

Keep the existing Rust-owned `auth.json`, `settings.json`, and `models.json` so
the settings UI and existing installs remain compatible. Add a least-privilege
`get_agent_runtime_config` command returning only the active provider/model,
model API/base URL metadata, and active API key. The key exists in WebView memory
only; it is never written to localStorage, transcript files, errors, or logs.

Saving/applying configuration invalidates the in-memory runtime and takes effect
on the next prompt. Remove all `restart_sidecar` calls and UI wording.

Use Tauri's native HTTP transport through one adapter so custom endpoints do not
depend on WebView CORS. Keep EPUB script CSP unchanged (`script-src 'self'`, no
`blob:`). Provider requests are allowed only when their URL is HTTP(S) and its
origin matches the active base URL resolved from Rust configuration.

## 8. Removal boundary

Only after the browser/Tauri spike, runtime, book worker, Pi v3 compatibility,
and UI tests pass:

- remove `sidecar/` and its lockfile;
- remove Rust `sidecar` / `sidecar_protocol`, commands, supervisor state, shell
  sidecar startup/shutdown, and book-open notification coupling;
- remove `bundle.externalBin`, binaries build/smoke scripts, release CI steps,
  version-bump sidecar fields, and stale comments/docs;
- remove dependencies used only by the external sidecar.

## 9. Risks and mitigations

- Browser bundling/provider regressions: mandatory live spike before deletion;
  lazy/provider-specific imports; lock matching Pi versions.
- WebView memory pressure: one active book worker and one active session Agent;
  terminate/drop on book/session changes; cap hydrated context to 12 turns.
- UI stalls: EPUB parse/index/search stays in the module worker.
- Credential exposure surface increases because Pi runs in WebView: preserve
  strict script CSP, never enable EPUB scripts, keep keys ephemeral, and route
  requests through one origin-checking adapter.
- Compatibility/replay bugs: official Pi v3 fixtures in both directions,
  structural Rust validation, one frontend decoder, leaf compare-and-append,
  migration backups, and branch/corrupt/truncated-line tests.
- Pi schema evolution: pin v3 explicitly; reject newer headers until a reviewed
  decoder/migration is added instead of guessing at future semantics.
