# 04: `GuideWorkspace` document-first flow & anchored side-threads

**Status:** resolved

**Blocked by:** 01, 02, 03

**What to build:** Build `GuideWorkspace`, a dedicated document-first UI for Guided reading that renders the Book's `GuideDocument` as a structured companion book (chapters → step sections → anchored side-threads) rather than a flat chat stream.

## Scope & Tasks

- [ ] Create `src/components/guide/` component suite consuming `GuideDocument` and shared assistant primitives (from Issues 01–03):
  - `GuideWorkspace.tsx`: Top-level guided reading canvas supporting both desktop workspace and compact/mobile docked layouts, exposing an imperative handle (`scrollToStep(stepIndex)`, `scrollToChapter(chapterIndex)`, `focusAskInput(passage?, chapterHref?)`, `guideTo(selection)`, `guideChapter(href)`).
  - `GuideChapterGroup.tsx`: Visual chapter header (`chapterTitle`, coverage pill / skimmed badge, "Open chapter in Book" action) grouping all `GuideStepSection`s belonging to that chapter.
  - `GuideStepSection.tsx`: Renders one `Guided step` without showing the mechanical `guideRequest` user bubble:
    - Clean section header bar: step range label (chapter/part/paragraphs), skim indicator, "Open in Book" jump link, `BranchSwitcher` (when step has sibling branches), and compact step menu (regenerate step).
    - Inline `GuideStepImages` strip directly beneath the header.
    - Explanation body via `AssistantMessage` (with `HoldHeight` while streaming, full `Citation` verification/jump, `MindmapCard`, and `AnswerProcess` tool timeline).
    - Action slot placeholder (`renderStepActions?`) ready for Issue 08.
  - `GuideSideThread.tsx`: Anchored follow-up Q&A list attached to the bottom of its parent `GuideStepSection`:
    - Displays side questions asked during that step cleanly separated from the main retelling prose.
    - Auto-expanded for the latest active step (or when streaming/editing); older steps default to a compact collapsible toggle (e.g., "2 follow-up questions") to keep long reading flows uncluttered.
    - Supports editing, regenerating, and branch switching on side questions identically to ordinary chat.
  - `GuideControlDock.tsx`: Bottom control dock that puts progression first:
    - Primary row: `GuideBar` actions (Continue / Start, "Read to…" `GuideRangePicker`, Skim, Skip chapter) + compact context-window control (`Layers` popover with active tokens, recap count, manual reset).
    - Secondary compact input: lightweight "Ask about this section…" composer (`ChatInput` with `ModelSwitcher` & thinking level) that handles pending Book selections cleanly.
- [ ] Preserve `guide_cut` and `CompactionNotice` inline dividers at their exact positions in the document flow.
- [ ] Adapt `ChatOutlineRail` inside `GuideWorkspace` to navigate chapters/steps/side-threads via `GuideDocument` indices (no manual message scanning).
- [ ] Wire `GuideWorkspace` into `ChatPanel` (as the `isGuided` branch) so Phase 2 is immediately testable and usable before Phase 3 changes top-level `ReaderMode`.
- [ ] Tests (`src/components/guide/GuideWorkspace.test.tsx`, `GuideSideThread.test.tsx`):
  - Mechanical `guideRequest` bubbles are not rendered; step sections and chapter headers render in order.
  - Side questions attach to the right step, collapse on older steps, expand on active/streaming step, and support edit/regenerate/branch switching.
  - Legacy `message.guide` sessions and streaming `guide_step` placeholders render cleanly.

## Acceptance Criteria

- Guided sessions render as a clean, chapter-structured companion document with anchored side-threads and zero "Continue" chat bubbles cluttering the reading flow.
- All existing guided behaviors (Continue, Skim, Skip, RangePicker, `guideTo`, `guideChapter`, branch switching, regenerate, inline images, citations, manual context cut, PageGuideCard "Open in guide") work end-to-end.

## Comments
