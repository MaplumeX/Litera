# 04: TOC as a scope panel in Agent mode

**Status:** resolved

**What to build:** In Agent mode the TOC opens next to the Session, not inside the Book pane, and opening it no longer forces the Book pane open. Clicking a chapter sets the **discussion scope**: a chip above the chat input shows the scoped chapter, and prompts use it as their `chapterHref`. If the Book pane is visible, it also goes to that chapter. The chip can be cleared, falling back to the Book pane's position.

- [x] Agent mode: the TOC button opens a TOC panel beside the Session (alongside or tabbed with the Session rail); the Book pane's collapsed state is untouched
- [x] Reading mode: the TOC drawer behaves exactly as today
- [x] Clicking a chapter sets the scope; the chip above the input shows its title
- [x] Prompts send the scoped `chapterHref` instead of `currentChapterHref`; selection captures still carry their own `chapterHref`
- [x] The scope persists across prompts until changed or cleared; it is per open book, not persisted
- [x] With the Book pane visible, picking a chapter also navigates the Book
- [x] Tests: App/ChatPanel tests that the TOC opens without un-collapsing the Book in Agent mode, and that a prompt after picking a chapter carries that chapter's href

**Notes:** No runtime change is needed. `chapterAside` already resolves `chapterHref` to `chapterIndex`. The force-open happens in `tocAnnotationButtons` in `src/App.tsx`; the annotations button has the same behaviour and should get the same treatment.

## Comments

- The annotations sidebar still expands a collapsed Book pane in Agent mode. Annotations are positions in the Book, and jumping to one needs the pane, so it keeps its current behaviour rather than getting the TOC's treatment.
- The scope chip only shows once a chapter is picked; without a scope, prompts fall back to the Book pane's position as before.
