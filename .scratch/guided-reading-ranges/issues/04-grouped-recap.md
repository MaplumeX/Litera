# 04: One recap for a step that finishes several chapters

**Status:** resolved

**Blocked by:** 01

**What to build:** When one guided step finishes several chapters, write one Chapter recap covering all of them instead of one per chapter.

- [x] Recap entry `details` can name a chapter range (first and last `chapterIndex` and titles); single-chapter recaps unchanged
- [x] Due-recap logic groups chapters finished by the same step; chapters finished over several steps still recap one by one
- [x] Recap input is the retelling of the steps covering the group; the model context names the range
- [x] Transcript marker shows the range
- [x] Tests: grouped due recap, mixed with single recaps, existing recap entries still read

## Comments

- Recap `details` gain optional `throughChapterIndex` / `throughChapterTitle`. An older build reads such a recap as covering its first chapter only, and may then write recaps for the others; harmless.
- `dueRecap` (replacing `dueRecapChapter`) returns the first due chapter plus every other unrecapped chapter the same step finished. `recappedChapters` turns recap entries into the covered chapters of the open Book, finding both ends by title when indices shifted.
- The recap prompt now allows several chapters; for a range it tells the model to cite each quote's own chapterIndex instead of substituting one. Model context: "Chapter recap (chapterIndex 3, "A" through chapterIndex 5, "B"), written when the guide finished these chapters".
- Transcript marker: "回顾：A → B". `CONTEXT.md` Chapter recap entry updated.
