# 04: Show guided steps as transcript markers

**Status:** resolved

**Blocked by:** 02

**What to build:** Every guided step (Continue, picker, selection, or asked for by the assistant) shows as a centered divider with its label instead of the reader's bubble: the reader never typed it, and after an assistant-started step the bubble repeated the assistant's own "好，接下来带读…".

- [x] `GuideStepMarker`: divider line, BookOpen icon (FastForward for a skim), the step's label, and the branch switcher when the step has branches
- [x] `ChatPanel` renders user messages with `guide` as the marker; the message stays a user message (cursor, progress, regenerate, message outline unchanged)
- [x] `MessageBubble` loses its `editable` prop: guided steps no longer reach it
- [x] Tests: `GuideStepMarker.test.tsx`; `ChatPanel.guided.test.tsx` checks the marker

## Comments

- Decided with the reader: all guided steps, not only assistant-started ones, so a Guided session has one look and no new field is needed.
- Not verified in the running app.
