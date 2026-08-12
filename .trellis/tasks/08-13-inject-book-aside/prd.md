# Inject book metadata and TOC as first-turn aside

## Goal

A new chat session should already know the current book's title, author, language, chapter count, and table of contents. The first answer must not wait on `get_book_metadata` + `get_toc` tool cards.

## Background

Metadata and TOC are already in sidecar memory after `open_book` (`sidecar/book.ts` `currentBook`). Those two tools only re-read the cache.

The system prompt at `sidecar/index.ts:36-44` is book-agnostic, so a new session's first turn almost always spends two tool calls learning the book.

Delivery is a first-turn aside, not a system-prompt embed. Reuse `sendCustomMessage(..., { triggerTurn: false, deliverAs: "nextTurn" })`, the same path as per-turn reading context at `sidecar/index.ts:449-459` (`08-12-fix-context-injection`).

## Requirements

1. On a prompt, if the active session does not already contain a `bookSnapshot` custom message, queue one aside (`customType: "bookSnapshot"`, `display: false`, `deliverAs: "nextTurn"`, `triggerTurn: false`) before `session.prompt()`.
2. The aside includes title, author, language, total chapter count, and a compact TOC of `index` + `label` only (no href).
3. TOC is truncated at 200 entries or 4000 formatted characters, whichever hits first. A truncated aside must say so and tell the model to call `get_toc` for the full list.
4. The aside must tell the model it already has this snapshot and should not call `get_book_metadata` / `get_toc` unless the TOC was truncated or it needs hrefs.
5. `bookSnapshot` and `readingContext` stay separate custom types. The same prompt may queue both.
6. Stored user message text remains the raw `command.text`.
7. Injection is idempotent: a session that already has `bookSnapshot` in `session.messages` (including after reload / switch) must not receive another copy.
8. Applies to brand-new sessions and older sessions that never received a snapshot. Do not rewrite historical tool-call transcripts.
9. Keep `get_book_metadata` and `get_toc` registered.
10. Update `READING_ASSISTANT_PROMPT` so those two tools are fallbacks, not first-turn required reads.
11. If snapshot fetch or enqueue fails, do not block the user prompt; the agent can still use the tools.

## Acceptance Criteria

- [ ] First prompt of a new session stores a user message equal to the original input (no snapshot text, no `用户问题：` wrapper).
- [ ] First prompt of a new session delivers the book snapshot on that turn, so the model can know the title and chapter list without calling `get_book_metadata` / `get_toc`.
- [ ] A TOC longer than 200 entries or 4000 formatted characters is truncated in the aside and the aside states that `get_toc` has the full list.
- [ ] Second prompt of the same session does not enqueue a second `bookSnapshot`.
- [ ] Reloading or switching back to that session does not enqueue another `bookSnapshot`.
- [ ] Chat UI does not render the snapshot (no extra bubble or tool card).
- [ ] Session list titles still derive from the first user message, not the snapshot.
- [ ] Per-turn `readingContext` (chapter / selection) still works on the same prompt as the first snapshot.
- [ ] `get_book_metadata` and `get_toc` remain callable.
- [ ] Sidecar type-checks and existing sidecar tests pass.

## Out of Scope

- Putting the snapshot in the system prompt.
- Synthesizing fake tool-call history.
- Removing `get_book_metadata` / `get_toc`.
- Frontend or protocol schema changes.
- Migrating old sessions that already contain those tool calls.
- Caching metadata/TOC on the sidecar main thread beyond this injection.
