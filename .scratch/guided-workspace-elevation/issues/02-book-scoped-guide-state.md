# 02: Book-scoped canonical Guide state (`useGuideDocument`)

**Status:** resolved

**Blocked by:** 01

**What to build:** Decouple Book-level guided artifacts (Book pane `guideMarks`, `PageGuideCard` data, and `TocSidebar` `guideProgress`) from `ChatPanel`'s currently active session. Subscribe directly to the open Book's canonical Guided session so marks and guide cards remain available even when the reader is in plain Reading mode or an ordinary Agent Q&A session.

## Scope & Tasks

- [ ] Add a Book-scoped canonical Guide snapshot API on `embeddedAgentRuntime` (or a dedicated helper module reading via `SessionPort` + subscribing to runtime events for the canonical Guided session):
  - Loads the canonical Guided session's active branch when a Book becomes ready (`book_ready`), even if the active chat session is an ordinary Q&A session or chat is collapsed.
  - Updates incrementally whenever the canonical Guided session completes a turn (`prompt_end`, `prompt_aborted`, `branch_switched`, `guide_window_updated`, `session_created`, `session_archived`, `session_deleted`, or `litera:sessions-synced`).
  - Does **not** disrupt or switch the user's currently open ordinary Q&A session in `embeddedAgentRuntime`.
- [ ] Create `src/lib/use-guide-document.ts` (`useGuideDocument(bookId, toc)`):
  - Combines the Book-scoped canonical Guide snapshot with `projectGuideDocument()` (from Issue 01) and `guideTocProgress` / `guidePageMarks` (replacing `useGuideBookMarks`).
  - Exposes `{ document: GuideDocument | null; steps: RecordedGuideStep[]; cards: GuideStepCardData[]; tocProgress: Record<string, GuideChapterProgress> | undefined; pageMarks: GuidePageMarks | null; canonicalSessionId: string | null; loading: boolean }`.
- [ ] Rewire desktop `src/App.tsx` and mobile `src/mobile/MobileReaderPage.tsx`:
  - Consume `useGuideDocument(fileData?.bookId ?? "", toc)` directly for `ReaderView` (`guideMarks`, `onViewGuideCard`), `PageGuideCard`, and `TocSidebar` (`guideProgress`).
  - Remove `guideSteps` / `guideCards` React state and `onGuideStepsChange` / `onGuideCardsChange` prop-drilling callbacks from `App.tsx`, `MobileReaderPage.tsx`, `AssistantSheet.tsx`, and `ChatPanel.tsx`.
  - Keep "Guide up to here" (`onGuideTo`) and TOC "Guide this chapter" (`onGuideChapter`) working even when the canonical Guide has not been opened yet (auto-targeting/creating the canonical Guided session).
- [ ] Tests:
  - Unit tests for `useGuideDocument` verifying that switching to an ordinary Q&A session keeps `pageMarks`, `tocProgress`, and `cards` intact.
  - Update affected tests (`src/App*.test.tsx`, `src/mobile/MobileApp.test.tsx`, `src/components/chat/ChatPanel.guided.test.tsx`).

## Acceptance Criteria

- In Reading mode (chat collapsed) or Agent mode (on an ordinary Q&A session), paragraphs already covered by the Book's canonical Guided session still display guide marks, TOC progress indicators, and open `PageGuideCard` on click/selection.
- Zero `onGuideStepsChange` / `onGuideCardsChange` callbacks remain between `ChatPanel` and host shells.

## Comments
