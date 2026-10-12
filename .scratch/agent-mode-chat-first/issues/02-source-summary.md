# 02: Per-answer source summary

**Status:** resolved

**What to build:** Under each assistant message that used book tools, show one compact line summarising what the answer is based on, e.g. "读了 第3章（全部 3 段）· 搜索 2 次，命中 5 处". When the assistant read only some parts of a chapter, the line says so (e.g. "第3章 仅读了 1/3") and is visually marked as partial. Expanding the line reveals the existing tool-call cards, which collapse into it instead of rendering one by one.

- [x] Derived purely from the turn's `read_chapter` and `search_in_book` tool calls and results (`chapterIndex`, `part`, `totalParts`, hit count); no new persisted data
- [x] Chapter names come from the TOC; parts read are aggregated per chapter
- [x] Partial coverage (parts read < `totalParts` for any chapter read) is flagged
- [x] Messages with no book tool calls show no summary
- [x] Works for historical messages, branches and synced Sessions (inherits from tool-call entries)
- [x] `draw_mindmap` cards keep rendering as they do today
- [x] Applies in both modes (it is message rendering), but is the main provenance surface in Agent mode
- [x] Tests: component tests for the summary text, the partial-coverage flag, and the no-tools case

**Notes:** Same derived-view approach as Mind Maps (`.scratch/draw-mindmap/spec.md`).

## Comments

- Implemented as `SourceSummaryCard`, rendered where the answer's first book tool call sits. `read_chapter` results now also carry `chapterTitle` so the summary can name chapters; older Sessions fall back to "章节 #N".
