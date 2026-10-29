# 04: The transcript marks the steps taken, with a way to their start in the Book

**Status:** resolved

**Blocked by:** 01, 02

**What to build:** Since 01, a step is a `guide_step` call, but the transcript still drew its marker from the reader's message: a step the reader asked for in their own words ("带读第3章") had none, and Continue's marker read "继续带读" instead of what was read. The marker follows the step, and offers to open its start in the Book.

- [x] A step marker for every `guide_step` call that took a step, above the reply, labelled with the step (`guideStepLabel`); several calls, several markers
- [x] `tool_end` carries the step, so the marker shows while the reply streams
- [x] Continue and picks (`guideRequest`) show as a quiet reader bubble, not editable; older Sessions' user-message steps stay markers
- [x] "在书中打开" on each marker: `guideStepAnchor` finds the step's first block with text to find (`findableGuideBlock`) and how many blocks of its chapter open alike before it; the Book pane counts its way there through the chapter's files (`findGuideParagraph`, from the chapter's anchor in a shared file), falling back to searching the opening text; "未能在书中定位" when the step has no such block

## Comments

- Searching the opening text alone landed on an earlier paragraph that opened alike, and only searched the chapter's first file; hence the count.
- Tests: `guide.test.ts` (`findableGuideBlock`), `guide-marks.test.ts` (`findGuideParagraph`), `embedded-runtime.guided.test.ts` (`tool_end` guide, `guideStepAnchor`), `agent-reducer.test.ts`, `GuideStepMarker.test.tsx`, `ChatPanel.guided.test.tsx`.
- Not verified in the running app.
