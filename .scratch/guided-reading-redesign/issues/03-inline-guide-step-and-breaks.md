# 03: Inline `guide_step` chapter text and natural section-break hints

**Status:** resolved

**Blocked by:** —

**What to build:** Eliminate the extra LLM round-trip on every guided step by returning the step's chapter text directly from `guide_step`, and give the model nearby section headings in `guideReadingState` so Continue actually stops at natural breaks.

- [x] Inline chapter text in `guide_step`:
  - When `guide_step` resolves `picked.span`, fetch its text directly via `book.readChapter` and include it in the `guide_step` tool result (up to a safe cap, e.g. 2 parts / ~24k chars); if a reader-picked span exceeds the cap, inline the first chunk(s) and list `read_chapter` calls only for the remaining tail
  - Update `guideStepContext`, `guidedPrompt`, and `guide_step` tool description so the model explains directly from the `guide_step` result instead of calling `read_chapter` again
- [x] Prunable `guide_step` body:
  - Allow Pruning (`context_prune` / `PRUNABLE_TOOLS`) to replace the chapter-text payload of older `guide_step` tool results with a compact placeholder while keeping `entry.guide` metadata intact so cursor, coverage, marks, and recaps never break
- [x] Natural section-break hints in `guideReadingState`:
  - Include a compact list of nearby heading blocks (e.g. headings within ±15 blocks or ±6k chars of the default step's `toBlock`, with block index and snippet) so the model can choose a clean section boundary on Continue without calling `list_guide_blocks` first
- [x] Smart default starting chapter before the first step:
  - Prefer `currentChapterHref` when open in the reader; otherwise skip obvious front-matter entries (cover, copyright, bare TOC pages) when proposing the initial step while still allowing manual TOC pick
- [x] Tests: `guide.test.ts`, `embedded-runtime.guided.test.ts`, `pi-session.test.ts` (single-round-trip step, oversized span fallback, pruning preserves `entry.guide`, heading hints)

## Comments
