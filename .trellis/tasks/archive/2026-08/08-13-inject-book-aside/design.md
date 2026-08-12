# Design: first-turn book snapshot aside

## Boundaries

Sidecar-only. No protocol, Rust, or frontend changes.

- New helper module `sidecar/book-snapshot.ts`: format, truncate, detect existing snapshot.
- `sidecar/index.ts`: queue the aside in `handlePrompt`, update `READING_ASSISTANT_PROMPT`.
- Tests: `sidecar/scripts/book-snapshot.node-test.ts`.

Worker metadata/TOC accessors stay as they are. No main-thread cache in this task.

## Data flow

```
handlePrompt
  requireCurrentBook
  ensure session
  if !sessionHasBookSnapshot(session.messages):
    try:
      meta, toc = worker.metadata + worker.toc  (same bookId/generation)
      text = formatBookSnapshot(meta, toc)
      sendCustomMessage({ customType: "bookSnapshot", content: text, display: false },
                        { triggerTurn: false, deliverAs: "nextTurn" })
    catch:
      stderr diagnostic; continue
  existing readingContext aside (unchanged)
  session.prompt(command.text)
```

`bookSnapshot` is queued before `readingContext` so the model sees identity first, then the current chapter / selection.

## Snapshot contract

`customType`: `bookSnapshot` (constant in the helper module).

Text shape (English, matching current tool result language):

```
Book snapshot (already provided; do not call get_book_metadata or get_toc unless the TOC is truncated or you need hrefs):
Title: ...
Author: ...
Language: ...
Total chapters: N

Table of Contents (K of M entries):
0: Chapter label
1: Next chapter
...
[TOC truncated. Call get_toc for the full list.]
```

The last line is present only when truncated.

### Truncation

Constants:

- `BOOK_SNAPSHOT_MAX_TOC_ENTRIES = 200`
- `BOOK_SNAPSHOT_MAX_TOC_CHARS = 4000`

Algorithm:

1. Take TOC entries in order, formatted as `${index}: ${label}` (no href).
2. Stop before exceeding 200 lines or 4000 characters of joined TOC body (newline-separated).
3. `truncated = included < toc.length`.
4. Metadata is never truncated.

Empty TOC: still emit metadata and `Table of Contents (0 of 0 entries):` with no body and no truncated note.

## Idempotency

`sessionHasBookSnapshot(messages)` is true when any message is a plain object with `role === "custom"` and `customType === "bookSnapshot"`.

This covers:

- Second prompt in the same live session (message already in `session.messages`).
- `switch_session` / `loadSessionFromDisk` (custom_message entries are restored).
- Compaction that drops the custom message (check fails → inject again).

In-memory `_pendingNextTurnMessages` is not inspected. `handlePrompt` is not re-entered while a prompt is active (`activePrompt` guard), so a session cannot queue two snapshots in one turn.

## System prompt

Keep the Litera identity. Reorder tool guidance:

- State that each session receives a book snapshot aside.
- `get_book_metadata` / `get_toc` are fallbacks for missing, truncated, or href-needed cases.
- `read_chapter` / `search_in_book` remain the primary content tools.

Do not put the snapshot text itself in the system prompt.

## Failure

Worker RPC or `sendCustomMessage` failure must not reject `handlePrompt`. Write a one-line `process.stderr.write` diagnostic (stdout is protocol-only) and continue. The model can still call the tools.

Book generation mismatch during fetch already throws from the worker; treat that as a skip, same as other fetch errors.

## Compatibility

- Existing sessions: first prompt after this change gets a snapshot if none is stored. Historical tool cards stay.
- Chat UI: unchanged; `serializeMessages` drops custom roles.
- Protocol: unchanged.

## Tradeoffs

Aside vs system prompt: user chose aside. Cost is one persisted custom_message per session and the snapshot tokens in later turns. Truncation bounds that cost.

Helper module vs inline in `index.ts`: extract so truncation/idempotency can be unit-tested without booting the agent. `index.ts` stays the wiring site.

Keep the two tools: truncation and hrefs still need them; removing them is out of scope.

## Rollback

Revert `sidecar/book-snapshot.ts`, its test, and the `index.ts` wiring/prompt change. Sessions that already persisted a `bookSnapshot` keep a harmless unread custom message; chat UI ignores it.
