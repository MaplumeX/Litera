# 02: "Read to…" picker in the GuideBar

**Status:** resolved

**Blocked by:** 01

**What to build:** A control next to Continue that opens a list of the blocks after the Guide cursor, so the reader picks where the step ends. Desktop and mobile (`AssistantSheet`).

- [x] Blocks after the cursor, grouped under their section headings and chapter titles, each with a first-line preview and length; loads more chapters on request
- [x] Tapping a block ends the step there; tapping a heading ends it at the end of that section (before the next heading of the same or higher level, or the chapter's end)
- [x] Choice of read or skim for the picked range
- [x] Warning when the range is longer than about two parts
- [x] Step labels (`guideStepLabel`, `guidePositionLabel`) for ranges: chapter titles at both ends, block numbers when a range starts or ends mid-chapter
- [x] zh-CN and en strings
- [x] Tests: picking a block, picking a heading, cross-chapter pick, labels

## Comments

- `GuideRangePicker` is a Dialog (same component on desktop and in the mobile sheet). It lists chapters from the next step's start: at least `GUIDE_OUTLINE_BLOCKS` (80) blocks at a time, more with a "Show later chapters" button rather than on scroll, which keeps it simple and testable in jsdom.
- Taps: a paragraph ends the step there; a heading ends it before the next heading of the same or higher level; a chapter title ends it at the chapter's end. The picked range is highlighted and the footer shows its length; over 2 × `CHAPTER_PART_CHARS` it warns. Read and Skim both send from there.
- Runtime: `guideOutline(step, after?)` (plan in `guideOutlinePlan`, blocks from the cached `guideBlocks`) and `guideStepTo(step, to, skim?)`, which normalizes a pick that is exactly a part back to a part step.
- Labels: a range in one chapter reads "带读：第三章（第 5–7 段）", across chapters "带读：第三章 → 第五章"; the Session list shows "第五章 · 第 1 段". Paragraph numbers are blocks + 1, the same numbers the picker shows.
- Not verified in the running app yet (needs a book and a model); covered by component tests only.
