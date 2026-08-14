# Hook Guidelines

> Lifecycle and concurrency rules for Litera React hooks.

## Embedded Agent bridge

`useAgentBridge` is the only React adapter for the singleton
`LiteraAgentRuntime`. It subscribes once, dispatches versioned local events to a
pure reducer, and exposes prompt/session operations to `ChatPanel`.

- Open book bytes through `embeddedAgentRuntime.openBook()` only after the
  version-bound Rust byte read succeeds.
- Copy a `Uint8Array` before transferring its buffer to the EPUB worker; never
  detach the reader's own byte view.
- `book_ready` is the readiness boundary. Prompts and session operations require
  the current book id and `bookReady` state.
- Ignore stale book events after navigation. Closing a book aborts the active
  prompt, terminates its worker generation, and returns the runtime to `idle`.
- Track prompt settlement by prompt id. A late completion from an older prompt
  must not settle or mutate the current one.
- `session_rewound` replaces the visible branch before the edited user message
  is appended and re-sent.

## Configuration invalidation

Agent configuration hooks invoke Rust for privileged JSON/key operations. After
any successful save, switch, update, or delete that changes the active provider,
invalidate the runtime cache so the next prompt calls
`get_agent_runtime_config` again. API keys must never enter React state, logs, or
session rows.

## Debounced persistence

Use one latest-value ref and one timer for reading position and settings writes.
The hook must expose `flush()` and `cancel()`:

- `flush()` sends the latest snapshot and awaits the in-flight write.
- `cancel()` is idempotent for StrictMode cleanup.
- A book change flushes the old book before replacing refs with the new book.
- Errors propagate to the owning component instead of being silently discarded.

## Native and OS-open effects

Register listeners before draining queued paths, normalize/dedupe EPUB paths,
and always return cleanup functions. Async registration must handle unmount
before the unlisten promise resolves.

## Testing

Use fake timers for debounce tests and a mocked runtime for Agent tests. Cover
StrictMode cleanup, stale book events, overlapping prompts, abort, config cache
invalidation, session rewind, and the initial queued OS-open race.
