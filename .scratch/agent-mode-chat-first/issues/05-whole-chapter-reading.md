# 05: Whole-chapter reading

**Status:** resolved

**What to build:** Let the assistant cover a whole multi-part chapter in one round trip, instead of paging `read_chapter` through 12,000-character parts one turn at a time (re-sending the whole context each time) and often stopping after part 0.

## Decision

No new tool or `read_chapter` option. The tool already reads any part. The real gap was that the model learns a chapter's part count only after reading part 0, so it cannot ask for every part up front.

- `BookTocEntry` gains `parts`, the number of `read_chapter` windows, computed with the same packing as `read_chapter` and cached per parsed chapter.
- The Book snapshot marks multi-part chapters: `3 [index 2]: 第三章 (3 parts)`. Single-part chapters stay unmarked to save snapshot space.
- `get_toc` returns `parts` for every entry.
- `read_chapter`'s description and the system prompt's `<tool_strategy>` tell the model to request every part of a chapter in the same turn when it needs whole-chapter coverage. pi-agent-core runs the tool calls of one assistant message in parallel by default (`toolExecution: "parallel"`), so a whole chapter costs one round trip.

This keeps the 12k window, so no size cap, no Compaction interaction and no Session format change. The trade-off is a slightly longer snapshot, so TOCs hit the 4,000-character snapshot cap a little sooner.

## Acceptance

- [x] `bookToc` reports `parts` equal to `read_chapter`'s `totalParts`
- [x] The snapshot marks multi-part chapters; single-part chapters are unchanged
- [x] `get_toc` includes `parts`
- [x] Tool description and system prompt ask for all parts in one turn when covering a whole chapter
- [ ] Checked with real models that they issue the parallel calls (the source summary from issue 02 shows partial coverage when they don't)
