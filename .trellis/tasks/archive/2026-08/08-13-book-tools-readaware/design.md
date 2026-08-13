# Design: book-text tools (toc / read / search)

## Boundaries

| Layer | Change |
|---|---|
| `sidecar/book.ts` | `searchInBook(queries: string[])`; hit shape; optional `chars` on TOC accessor |
| `sidecar/book-worker.ts` | Search RPC takes `queries: string[]` |
| `sidecar/index.ts` | Tool schemas, descriptions, system prompt, JSON results, read-chapter windowing |
| `sidecar/book-snapshot.ts` | TOC line format + header wording |
| Tests | Snapshot, new book-search/window unit tests, worker integration search arg |
| Frontend / Rust protocol | None |

Tools remain bound to the session's `bookId` + `generation`. No spoiler state.

## Contracts

### `get_toc`

Input: none.

Output (JSON text):

```json
[
  { "chapterIndex": 0, "chapterNumber": 1, "title": "Loomings", "chars": 1234 }
]
```

`chars` comes from `chapterTexts.get(index)?.length ?? 0`. Internal `TocEntry.href` stays on the parser type for EPUB loading; it is stripped before the model sees the list.

### `read_chapter`

Input: `{ chapterIndex: number, part?: number }`.

```
totalParts = max(1, ceil(text.length / 12000))
window = clamp(part ?? 0, 0, totalParts - 1)
text = slice(window * 12000, (window + 1) * 12000)
```

Output:

```json
{ "chapterIndex": 0, "chapterNumber": 1, "part": 0, "totalParts": 3, "text": "..." }
```

Missing chapter → `errorResult`, not throw (`error-handling.md`).

### `search_in_book`

Input: `{ queries: string[] }` (`minItems: 1`). Extra queries beyond 12 are dropped in execute, not by schema (avoid a validation-failed wasted turn).

Pipeline (one worker call):

1. Trim, drop empty, dedupe, cap 12.
2. For each query:
   - Prefer exact `indexOf` in chapter texts (up to 3 hits/chapter). These are `match: "exact"` and also satisfy FTS for that chapter.
   - If the query has no exact hit anywhere, FTS5 `MATCH` on the escaped query to find candidate chapters, then token-AND fallback on those / all chapters.
   - Tokenize like ReadAware: split on punctuation/whitespace, drop tokens shorter than 2. Require all tokens, or half when there are ≥ 4 tokens. First present token's offset is the snippet anchor. `match: "partial"`.
3. Dedupe key: `${chapterIndex}:${floor(offset / 200)}`.
4. Concatenate exact then partial; slice 16.
5. `part = floor(offset / 12000)`. `chapterTitle` from TOC label at the same index, omitted if missing.
6. Snippet: 160 chars of radius around the match, with `…` when clipped. Keep FTS `snippet()` only if we still go through FTS without an offset; prefer the shared `snippetAround` helper so `part` is honest.

FTS query string: wrap as a quoted phrase after escaping `"` as `""`. If `MATCH` throws, treat that query as no FTS candidates and continue with exact/token paths.

### Book snapshot

Header: drop "or you need hrefs".

TOC line: `{chapterNumber} [index {chapterIndex}]: {label}`.

Truncation still counts formatted line length against 4000 / 200 entries.

## Data flow

```
model tool call
  → sidecar/index.ts execute (generation gate)
  → BookWorker RPC (bookId + generation)
  → book.ts accessors
  → JSON text tool result
  → tool_end event (opaque result) → ToolCallCard
```

`read_chapter` windowing happens in `index.ts` after the worker returns full text so worker RPC stays one field (`index`).

`search_in_book` merge happens in `book.ts` so the worker does not round-trip once per query variant.

## Compatibility

- Stdio protocol unchanged.
- Old `search_in_book({ query })` / `read_chapter({ index })` calls in JSONL history are not replayed; new schema is for new turns only.
- Worker integration tests that call `search(bookId, generation, query)` must pass `queries: string[]`.

## Trade-offs

- **Keep FTS5** instead of copying ReadAware's JS-only search. Litera already paid for trigram WASM; ReadAware's file comments say FTS is the destination.
- **Exact `indexOf` first** so `part` has a real offset. FTS `snippet()` alone does not give a usable chapter offset.
- **JSON tool results** instead of prose. The model must copy `chapterIndex` / `part`; structured fields beat "Chapter 3: …".
- **No `bookId`**. Litera tools are session-bound; adding it would only create a mismatch with `currentBook`.

## Rollback

Revert the sidecar files listed above. No data migration. In-flight sessions keep working; they just see the previous tool schemas after revert.
