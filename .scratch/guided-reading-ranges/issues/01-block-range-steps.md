# 01: Block-range guided steps

**Status:** resolved

**What to build:** The data model and runtime for guided steps that cover a range of blocks, possibly across chapters (see the spec's Implementation Decisions). No new UI yet: Continue sends the default step, now expressed as a range.

- [x] `GuideStep` gains `from` / `to` (`{ chapterIndex, block, snippet? }`); old part-based steps convert to the block range of their part
- [x] Positions resolve by index, falling back to `snippet` when the block at that index no longer matches
- [x] `nextGuideStep`: the rest of the current part when the cursor is inside one, else the next part (same results as today for part-aligned cursors)
- [x] `read_chapter` accepts `fromBlock` / `toBlock`; a range over `CHAPTER_PART_CHARS` splits into sub-ranges with the `chapterWindows` cut costs
- [x] `guideStepContext` lists the exact reads for single-chapter, multi-chapter and oversize ranges; guided prompt wording updated from "part" to "range"
- [x] `chapterCoverage`, `dueRecapChapter`, `guideTocProgress`, `skipChapterStep` work on blocks
- [x] Book port `guideBlocks(chapterIndex)`: preview, length, heading level, part per block
- [x] `CONTEXT.md` Guide cursor entry updated
- [x] Tests: old-step conversion, mid-part cursor, cross-chapter range, oversize split, snippet fallback, coverage and recap due on blocks

## Comments

- Steps keep `chapterIndex` / `part` / `totalParts` (the part `range.from` is in) next to the new `range`, so an older app build reading a synced Session still decodes them; without `range` a step means its part, as before. `resolveGuideStep` turns a range that is exactly one part (or, skimming, a part to the chapter's end) back into a plain part step.
- TOC entries carry `blocks` and `partStarts`, so `guide.ts` stays pure. Range reads are cut at part ends (`rangeReads`), so no read is longer than a part and no new size logic was needed.
- Snippets: `findGuideBlock` (pure) plus a per-Book `guideBlocks` cache in the runtime; applied to recorded steps for the next step, TOC progress and recaps, and filled in when a range step is sent.
- The Skim button now asks the runtime for the skim (`guideSkimStep`), since a skim from mid-part needs the chapter's last block.
- TOC progress is block-based and shows a percentage (rounded down; 100% only when done).
- Not done here: step labels for range steps still read like the part they start in. That belongs to 02.
