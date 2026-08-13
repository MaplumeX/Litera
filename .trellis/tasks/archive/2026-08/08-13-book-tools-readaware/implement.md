# Implement: book-text tools

## Checklist

1. Extract shared constants + pure helpers (`CHAPTER_PART_CHARS`, query cleanup, `windowChapterText`, `snippetAround`, search merge) next to or imported by `sidecar/book.ts`.
2. Change `searchInBook` to `queries: string[]` and the new hit shape. Add `chars` when serving TOC to tools (`getToc` or a thin wrapper used by the worker).
3. Update `sidecar/book-worker.ts` search request/response types and `BookWorker.search`.
4. Update `createBookTools` + `READING_ASSISTANT_PROMPT` in `sidecar/index.ts`: schemas, JSON `okResult`, `read_chapter` windowing, no href / no spoiler copy.
5. Update `formatBookSnapshot` line format and header; fix `sidecar/scripts/book-snapshot.node-test.ts`.
6. Add `sidecar/scripts/book-search.node-test.ts` (or equivalent) covering: multi-query merge, 16-hit cap, exact vs partial, `part` for a match past 12000 chars, `windowChapterText` clamp.
7. Update `sidecar/scripts/book-worker.integration.ts` search call site to `queries: string[]`.
8. Run `npm test` in `sidecar/`.

## Validation

```bash
cd sidecar && npm test
```

Optional after a sidecar rebuild if touching packaged worker behavior beyond unit tests:

```bash
cd sidecar && npm run build && npm run smoke
```

## Risky files

- `sidecar/book.ts` — FTS + search semantics; keep `errorResult` path in the tool, throw only from accessors when no book is loaded (existing pattern).
- `sidecar/index.ts` — prompt + four-tool surface; do not change `get_book_metadata` beyond prompt wording if it still mentions TOC/hrefs.
- `sidecar/book-worker.ts` — request union must stay exhaustive.

## Rollback

Git revert the sidecar commits. No library.json / session migration.

## Follow-up before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md` written
- [x] Research note at `research/readaware-book-tools.md`
- [x] `implement.jsonl` / `check.jsonl` have real spec + research entries
- [ ] User approved this planning summary
