# State Management

> Litera keeps state local and separates durable Rust state from ephemeral UI and Agent state.

## State ownership

- Rust owns durable library metadata, preferences, annotations, Agent config,
  and Pi v3 session files. Per-book last reader/Agent mode is
  `BookRecord.lastReaderMode`. Per-book chrome layout is
  `BookRecord.lastLayout` (`chatCollapsed`, `bookCollapsed`,
  `sessionRailOpen`). Per-book reopen locator is `BookRecord.lastCfi`;
  `lastFraction` is percent for the library card and scrubber, not a page
  locator. Do not put `lastCfi` on `ReadingSettings`, `annotations.json`, or
  `localStorage`.
- React owns route/layout/form state and the reducer projection used by chat UI.
  App default mode (`litera.defaultReaderMode`) and pane widths live in `localStorage`.
  TTS rate/voice live in `localStorage` (`litera.ttsRate` / `litera.ttsVoice`);
  playing/paused is process-only and must not be persisted.
  `tocVisible`, `tocExpanded`, and `annotationsVisible` are process-only.
  Do not persist them. `tocExpanded` is sibling-index path keys for the open
  book's TOC tree; reset it on book switch / back to library, not on drawer
  close. Do not key it by href.
  Switching Reader ↔ Agent must not reset `lastLayout` flags.
  Last-used highlight color is process-only
  (`src/lib/annotations.ts` module state); do not persist it. Mutate the open
  book's annotation snapshot through `annotationsRef` so a HighlightEditor
  unmount (delete, then note flush) cannot resurrect a just-removed row from a
  stale React state closure.
- `LiteraAgentRuntime` owns the active book worker, model stream, session leaf,
  and monotonically increasing local event version.
- The EPUB worker owns extracted chapter text and search indexes for the currently
  open book only.

Do not duplicate API keys, EPUB payloads, or complete session stores in component
state. Components receive snapshots and callbacks from hooks.

## Agent reducer

`agentReducer` is pure. It accepts only events with a version greater than the
current state version, then applies book/session/prompt/tool-call correlation
before mutating visible state.

The lifecycle is:

```
idle -> loadingBook -> bookReady -> prompting -> bookReady
                                  \-> error
```

`session_created` optimistically inserts a local summary so a new empty session
is visible before its first persisted message. Session list refreshes de-duplicate
by id and preserve the current session when it is still present.
`session_config_updated` upserts the per-session `systemPrompt` onto the
matching summary (or inserts one when the list has not loaded yet) so session
settings stay visible without a full list refresh. Thinking level is no longer
a per-session field; it is a global setting read from `AgentConfigSnapshot`
and controlled from the ChatInput toolbar.

Book changes reset messages, prompt state, sessions, errors, and compaction.
Late events for an old book or prompt advance no user-visible state.

Context compaction emits three `PromptCorrelation` events from `maybeCompact`:
`compaction_started` (before summarization), `compaction_completed` (after the
compaction entry is persisted), and `compaction_failed` (catch path, swallowed
error). The reducer projects these onto `state.compaction` (`{ status:
"compacting" | "compacted" } | null`). `prompt_end` / `prompt_aborted` keep
`compaction` so the compacted marker stays in the chat flow; `session_switched`,
`session_rewound`, `book_loading`, `book_closed`, and `book_changed` clear it.
The marker is process-only and is not rebuilt from session entries on re-entry
— users see it only when compaction happens in the current view.

Tool results render as read-only expandable cards; they are never parsed into
clickable book locators. Reader jumps are owned by the chrome: TOC, prev/next
chapter, and the annotation drawers. Do not parse assistant Markdown as book
locators, and do not keep a second reader-location store in chat state.

Assistant messages carry an ordered `blocks` array (`AssistantBlock`: `thinking` |
`text` | `toolCall` — see `src/types/agent.ts`); block order is the rendering
contract and must match event arrival order. Thinking deltas stream as
`thinking_start` / `thinking_delta` / `thinking_end` `PromptCorrelation` events;
the reducer folds `thinking_delta` / `text_delta` onto the last block when it
has the same type, otherwise opens a new block (`thinking_start`/`end` are
no-ops). `tool_start` pushes a toolCall block; `tool_end` fills
`result`/`done`/`isError` by `toolCallId` (out-of-order completion supported).
Every block mutation also syncs the message's `content` (join of text blocks)
for consumers outside AssistantMessage. AssistantMessage renders blocks in
array order; each thinking block is collapsible and auto-expands only while
its message is the streaming last message. `visibleMessages()` in
`pi-session.ts` rebuilds the same ordered blocks from persisted entries
(including thinking) and merges consecutive assistant entries into one bubble.
Token usage/cost are not surfaced anywhere (deliberate product decision).

`retry_scheduled` events (bounded retry via pi-ai `retryAssistantCall`, SDK
`maxRetries: 3`) are emitted per backoff attempt but carry no reducer state;
the UI hint is future work. Prompt failures are classified by
`classifyPromptError` into preset credential-free Chinese messages — raw
provider error text never reaches reducer state or logs.

## Durable writes

Library/preferences/annotation mutations go through Tauri commands. Reading
position (`lastFraction` + `lastCfi` in one relocate invoke), typography
settings, `lastReaderMode`, and `lastLayout` are debounced but flush on
navigation/unmount. Do not write `lastCfi` / `lastFraction` into `currentBook`
on every relocate — that re-opens `ReaderView`. Changing the Settings default
mode must not call `update_reading_state`. Pane widths stay in `localStorage`;
do not send them on this command. Pi session appends include the expected leaf
id; stale writers fail rather than overwrite a new branch.

## Configuration

Forms keep draft provider/model values locally. Applying a draft performs one
Rust mutation sequence, updates the masked snapshot, and invalidates the embedded
runtime cache. Provider selection alone never changes the live model.

## Testing

Reducer tests cover version ordering, stale correlation, streaming deltas,
tool-call matching, optimistic sessions, rewind, abort, errors, and compaction
state transitions (started / completed / failed / session-switch clear). Hook tests
cover subscription cleanup, runtime method guards, and durable-write sequencing.
