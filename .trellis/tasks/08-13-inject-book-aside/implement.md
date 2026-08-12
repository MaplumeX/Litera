# Implement: first-turn book snapshot aside

## Checklist

1. Add `sidecar/book-snapshot.ts`
   - Export `BOOK_SNAPSHOT_CUSTOM_TYPE`, entry/char limits, `formatBookSnapshot`, `sessionHasBookSnapshot`.
   - Format and truncate exactly as `design.md` specifies.
2. Add `sidecar/scripts/book-snapshot.node-test.ts`
   - Short TOC is complete; no truncated note; no hrefs.
   - 201 entries → 200 lines + truncated note.
   - Long labels hit the 4000-char cap with fewer than 200 lines + truncated note.
   - Empty TOC has metadata and `0 of 0`, no truncated note.
   - `sessionHasBookSnapshot` is false for empty / `readingContext` only, true when `bookSnapshot` is present.
3. Wire `handlePrompt` in `sidecar/index.ts`
   - After the session is established, if no snapshot, fetch metadata+toc from the current book worker, format, `sendCustomMessage` with `nextTurn`.
   - Catch failures; do not block `prompt()`.
   - Leave the existing `readingContext` block after the snapshot queue.
4. Update `READING_ASSISTANT_PROMPT` so metadata/TOC tools are fallbacks.
5. Validate.

## Validation

```bash
npm run -w sidecar test
```

That runs `tsc --noEmit` and the sidecar node tests, including the new file via `scripts/*.node-test.ts`.

No frontend, Rust, or protocol tests are required.

## Risky files / rollback

- `sidecar/index.ts` — `handlePrompt` and the system prompt. A bad enqueue must not break `readingContext` or user-text purity.
- New helper/test files are additive; delete them to roll back.

Do not change `sidecar/protocol.ts`, Rust, or the web UI.

## Follow-up before `task.py start`

- `prd.md`, `design.md`, `implement.md` are present.
- `implement.jsonl` / `check.jsonl` have real spec + research entries.
- Planning summary approved by the user.

## Phase 3.3 spec note

After implementation, extend `.trellis/spec/backend/quality-guidelines.md` "inject reading context as a nextTurn aside" to also cover the one-time `bookSnapshot` aside (idempotent, truncated TOC, do not block prompt on fetch failure).
