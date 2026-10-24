# 01: Section-aligned chapter parts

**Status:** resolved

**What to build:** `chapterWindows` cuts long chapters at section boundaries and balances part sizes (see the spec's "Part cutting"). Guide cursors from the old cutting still continue sensibly.

- [x] Cuts prefer just before headings and scene breaks, never right after a heading
- [x] Parts of a chapter are about equal; at most one part more than greedy packing
- [x] Windows still ≤ `CHAPTER_PART_CHARS` and rejoin to the chapter Markdown
- [x] `nextGuideStep` maps a cursor whose `totalParts` no longer matches onto the new parts
- [x] Tests: heading-aligned cut, no orphaned heading, balanced sizes, extra part only when it buys section cuts, old-cursor mapping

## Comments

- `chapterWindows` in `src/agent/book/epub-content.ts` now runs a DP over the paragraph blocks for the greedy count and count + 1; costs are named constants next to it. Worst case measured: a 300k-character chapter of 20-character lines takes ~270 ms once (cached per chapter); normal chapters are near 0 ms.
- Old cursors: `nextGuideStep` and the TOC progress map a step's covered share onto the current part count (`coveredParts` in `guide.ts`).
- Fixed along the way: `search_in_book` hits now report the part that really holds them (`partAt`), not `offset / CHAPTER_PART_CHARS`.
