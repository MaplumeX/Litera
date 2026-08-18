# State Management

> Litera keeps state local and separates durable Rust state from ephemeral UI and Agent state.

## State ownership

- Rust owns durable library metadata, preferences, annotations, Agent config,
  and Pi v3 session files. Per-book last reader/Agent mode is `BookRecord.lastReaderMode`.
- React owns route/layout/form state and the reducer projection used by chat UI.
  App default mode (`litera.defaultReaderMode`) and pane widths live in `localStorage`.
  TTS rate/voice live in `localStorage` (`litera.ttsRate` / `litera.ttsVoice`);
  playing/paused is process-only and must not be persisted.
  `chatCollapsed`, `bookCollapsed`, `sessionRailOpen`, `tocVisible`, and
  `annotationsVisible` are process-only.
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

Book changes reset messages, prompt state, sessions, and errors. Late events for
an old book or prompt advance no user-visible state.

Tool results render as read-only expandable cards; they are never parsed into
clickable book locators. Reader jumps are owned by the chrome: TOC, prev/next
chapter, and the annotation drawers. Do not parse assistant Markdown as book
locators, and do not keep a second reader-location store in chat state.

## Durable writes

Library/preferences/annotation mutations go through Tauri commands. Reading
position, typography settings, and `lastReaderMode` are debounced but flush on
navigation/unmount. Changing the Settings default mode must not call
`update_reading_state`. Pi session appends include the expected leaf id; stale
writers fail rather than overwrite a new branch.

## Configuration

Forms keep draft provider/model values locally. Applying a draft performs one
Rust mutation sequence, updates the masked snapshot, and invalidates the embedded
runtime cache. Provider selection alone never changes the live model.

## Testing

Reducer tests cover version ordering, stale correlation, streaming deltas,
tool-call matching, optimistic sessions, rewind, abort, and errors. Hook tests
cover subscription cleanup, runtime method guards, and durable-write sequencing.
