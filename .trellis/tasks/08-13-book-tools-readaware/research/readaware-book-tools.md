# ReadAware overlapping book tools (2026-08-13)

Source: https://github.com/ahpxex/read-aware `packages/agent/src/tools/book-text-tools.ts` and `packages/agent/src/text/search.ts` on `main`.

## What we are copying

| Tool | ReadAware contract | Why it is better |
|---|---|---|
| `get_toc` | `{ chapterIndex, chapterNumber, title, chars }`; hide href | `chapterNumber` (1-based) stops off-by-one; `chars` tells the model whether `read_chapter` needs more than one part |
| `read_chapter` | `chapterIndex` + optional `part` (default 0); 12000-char windows; `{ chapterIndex, part, totalParts, text }` | EPUB chapters can be tens of thousands of characters; unbounded text blows the context |
| `search_book_text` | `queries[]` (cap 12), merge/dedupe, limit 16, hit carries `chapterIndex`, `chapterTitle`, `part`, `match`, `snippet` | One wording miss should not cost a full LLM round trip |

## What we are not copying

- `bookId` / whole-shelf search (Litera tools are bound to the open book + generation)
- `confirmSpoiler`, `spoilerFence`, `throughChapterIndex`
- "never `read_chapter` the current chapter" (depends on a reading cursor Litera does not have)
- Replacing Litera's in-memory FTS5 with ReadAware's temporary JS `indexOf` + token AND (`search.ts` comments that FTS is the target backend)
- `ask_user`, annotations, memory, shelf, settings

## Litera-specific mapping

- Keep tool names `get_toc`, `read_chapter`, `search_in_book`.
- Keep FTS5 trigram as the primary matcher; add multi-query merge, hit cap, `part`, and a token-AND fallback when a query has no FTS/`indexOf` exact hit.
- Windowing lives in the tool layer after `readChapter()` returns full text (same split as ReadAware: storage returns the chapter, tool slices).
- Book snapshot is the model's default TOC. Update its line format so the common path also exposes `chapterNumber` / `chapterIndex` without calling `get_toc`. Do not put hrefs in the snapshot (already true).
