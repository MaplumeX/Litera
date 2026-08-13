# Align book tools with ReadAware (toc / read / search)

## Goal

Make Litera's three book-reading tools (`get_toc`, `read_chapter`, `search_in_book`) match ReadAware's overlapping contracts so the model can pick the right chapter, read long chapters in windows, and search with several wordings in one call — without adding spoiler controls or a multi-book tool surface.

## Background

Litera already injects a book snapshot (title, author, language, compact TOC) and exposes four sidecar tools. The three reading tools today are:

- `get_toc` — `index: label (href)` prose; href is unused by any other tool (`sidecar/index.ts` `createBookTools`)
- `read_chapter(index)` — full chapter text, no size cap (`sidecar/book.ts` `readChapter`)
- `search_in_book(query)` — one FTS5 string, unbounded hits, chapter index + snippet only (`sidecar/book.ts` `searchInBook`)

ReadAware's book-text tools (`packages/agent/src/tools/book-text-tools.ts`) fix the real failure modes: chapter-number off-by-one, long-chapter context blowups, and single-query FTS misses that cost a full LLM round trip. Litera keeps its single-book sidecar, FTS5 index, and no-spoiler product stance.

## Requirements

1. **R1 TOC for the model** — `get_toc` returns structured entries `{ chapterIndex, chapterNumber, title, chars }`. Do not include `href`. `chapterNumber` is `chapterIndex + 1`. `chars` is the stored chapter text length for that index (0 if the chapter has no extracted text).
2. **R2 Snapshot TOC** — `formatBookSnapshot` lines show both numbers so the common path does not require `get_toc`. Format: `{chapterNumber} [index {chapterIndex}]: {title}`. Keep the 200-entry / 4000-char caps. Still omit hrefs. Snapshot header must no longer say "or you need hrefs".
3. **R3 Read windows** — `read_chapter` takes `chapterIndex` and optional `part` (default 0). Window size is 12000 characters. Result is structured `{ chapterIndex, chapterNumber, part, totalParts, text }`. Out-of-range `part` clamps to the last window. Missing chapter still returns a tool error result (does not throw).
4. **R4 Multi-query search** — `search_in_book` takes `queries: string[]` (min 1). Trim, drop empties, dedupe, keep at most 12. Merge hits, exact before partial, cap at 16. Each hit is `{ chapterIndex, chapterTitle, part, match, snippet }` where `part` is `floor(offset / 12000)` and `match` is `"exact"` or `"partial"`.
5. **R5 Search engine** — Keep the in-memory FTS5 trigram index as the primary matcher. When a query has no exact substring hit, apply a token-AND fallback (tokens length ≥ 2; if ≥ 4 tokens, require half). Do not add spoiler fences, `throughChapterIndex`, or `bookId`.
6. **R6 Prompt** — System prompt / tool descriptions tell the model: copy `chapterIndex` from TOC (match spoken "chapter N" to `chapterNumber`); start `read_chapter` at `part` 0; pass several search phrasings in one call. Remove href and spoiler language.
7. **R7 Compatibility** — Sidecar stdio command/event protocol is unchanged (`tool_start.params` stays opaque). Worker RPC may change. Old session transcripts that recorded the previous tool argument shapes remain display-only.

## Acceptance Criteria

- [ ] AC1 `get_toc` output lists `chapterIndex` / `chapterNumber` / `title` / `chars` and contains no href.
- [ ] AC2 A 3-entry snapshot contains `1 [index 0]:` … `3 [index 2]:` and does not mention hrefs or "need hrefs".
- [ ] AC3 A chapter of 25000 characters: `part` 0 returns 12000 chars and `totalParts` 3; `part` 2 returns the remainder; `part` 99 clamps to part 2.
- [ ] AC4 `search_in_book({ queries: ["alpha", "bravo"] })` searches both strings in one call and returns ≤ 16 merged hits with `part` and `match`.
- [ ] AC5 A query with no exact phrase but whose tokens all appear in a chapter returns `match: "partial"` rather than empty.
- [ ] AC6 System prompt no longer tells the model to call `get_toc` for hrefs, and does not mention spoilers.
- [ ] AC7 Existing sidecar tests (`npm test` in `sidecar/`) pass, including updated snapshot tests and new unit tests for windowing and search merge.

## Out of Scope

- Spoiler fence, `confirmSpoiler`, `throughChapterIndex`, reading-cursor injection
- `bookId` on tools, cross-book / shelf search
- `get_book_metadata` contract changes
- Aligning TOC nav index with spine index (pre-existing; `chars` / `read_chapter` keep using the same index `readChapter` already uses)
- Frontend `ToolCallCard` redesign
- Renaming `search_in_book`
- Plugin / extra tools

## Technical Notes

- Windowing is applied in the tool layer after `BookWorker.readChapter` returns full text.
- Search merge / fallback lives next to FTS in `sidecar/book.ts` so one worker RPC still serves one tool call.
- Tool results stay `okResult` / `errorResult` text payloads; structured objects are JSON text for the model. Frontend already renders string or `JSON.stringify`.
- Constants: `CHAPTER_PART_CHARS = 12000`, `SEARCH_QUERY_CAP = 12`, `SEARCH_HIT_LIMIT = 16`.
