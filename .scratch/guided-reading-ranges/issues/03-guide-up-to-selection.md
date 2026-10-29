# 03: "Guide up to here" from a reader selection

**Status:** resolved

**Blocked by:** 01

**What to build:** A selection toolbar action, shown while the open Book has an active Guided session, that sends a guided step from the cursor to the selected paragraph.

- [x] `SelectionToolbar` action, desktop and mobile; hidden when no Guided session is active for the Book
- [x] Selection to block: `chapterForHref` on the selection's href, then the block containing the selected text (same matching as `locateQuote`)
- [x] A selection at or before the cursor is refused with a short message (no going back, no gaps)
- [x] ~~Unmatched selection falls back to the end of the matched chapter~~ An unmatched selection shows a message (see Comments)
- [x] Tests: selection mapping, selection before the cursor, unmatched text

## Comments

- Toolbar: an icon button ("带读到这里", same icon as the picker) between Copy and Ask, shown only while the open Book has a Guided session (desktop: `guideSteps !== null` in App; mobile: `AssistantSheet` now passes `onGuideStepsChange` up to `MobileReaderPage`). It sends the step at once and shows the chat (desktop) or brings the sheet up to half (mobile).
- Matching: `locateGuideBlock` in the worker matches the selection's last line, so a selection over several paragraphs ends at the last one. It looks in the selection's chapter first, then the whole Book, because a spine file split into several TOC chapters can report the first one's href.
- Changed from the plan: an unmatched selection shows "没能在书里找到选中的文字" instead of falling back to the chapter's end. Reading to an end the reader did not pick seemed worse than asking them to try again; in practice the text comes from the same Book and should match.
- A selection before the step's start: "选中的位置已经带读过了。带读只能往后读，不会留下空缺。" While an answer streams, the action asks the reader to wait.
- Not covered by an App/mobile integration test (those mock ReaderView); the runtime, ChatPanel handle, toolbar and worker matching have tests. Not verified in the running app.
