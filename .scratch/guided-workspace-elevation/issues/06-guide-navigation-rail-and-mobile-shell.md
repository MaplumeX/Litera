# 06: `GuideNavRail` (desktop) & mobile shell adaptation

**Status:** resolved

**Blocked by:** 05

**What to build:** Give desktop Guide mode its own book-oriented left navigation rail (`GuideNavRail`) in place of `SessionList`, and adapt the Android/mobile shell (`MobileReaderPage.tsx`, `AssistantSheet.tsx`, `assistant-sheet.ts`) so phone/tablet users also get first-class access to `GuideWorkspace` alongside free-form Q&A.

## Scope & Tasks

- [ ] Build desktop `src/components/guide/GuideNavRail.tsx` (toggled by the titlebar rail button in `guide` mode, sharing resizable width persistence):
  - **Progress header**: Book coverage summary (e.g., `X / Y chapters` or overall step coverage bar) + quick jump to current `Guide cursor`.
  - **Chapters tab** (default): Book TOC tree enriched with per-chapter guide state (`unread`, `in_progress`, `skimmed`, `completed`, `current` highlight):
    - Clicking an already-covered chapter scrolls `GuideWorkspace` directly to that chapter's `GuideChapterGroup`.
    - Hover/secondary action on any chapter (including unread chapters): "Guide from here" (`guideChapter(href)`).
  - **Questions tab**: Flat chronological index of all side questions (`GuideSideQaNode`) across the Book grouped by chapter; clicking scrolls directly to and expands that `GuideSideThread`.
  - **Footer / Guide settings trigger**: Opens guide-specific settings (editing per-session prompt / global guided style shortcut, context window stats + manual reset, "Archive current guide & start over", and read-only viewer for archived/legacy Guided sessions if any exist).
  - **Note on `Chapter recap`**: Respect the existing decision in `CONTEXT.md` and `.scratch/guided-reading-redesign/issues/06`—keep `Chapter recap` silent (model-only memory), do **not** add a user-facing recap drawer.
- [ ] Adapt Android / mobile shell:
  - `src/lib/assistant-sheet.ts`: map three-mode `ReaderMode` (`reader` → collapsed, `guide` → full/half on Guide tab, `agent` → full/half on Ask tab) without breaking existing drag/snap physics.
  - `src/mobile/AssistantSheet.tsx`: add a clean top segmented switcher inside the sheet header (`Guide` | `Ask`) that mounts `GuideWorkspace` (compact/mobile variant) vs `ChatWorkspace` (docked variant), keeping both states alive while collapsed so drafts and in-flight streams survive.
  - `src/mobile/MobileReaderPage.tsx`:
    - Add a mobile Guide chapter-progress drawer or integrate guide jump actions cleanly with the existing TOC drawer.
    - Ensure selection actions ("Guide up to here", "View guide explanation" → `PageGuideCard`, "Ask") automatically switch `AssistantSheet` to the matching tab (`Guide` vs `Ask`) and raise it to `half` when collapsed.
    - Ensure `PageGuideCard`'s "Open in guide" switches the sheet to the `Guide` tab and scrolls to the target step.
- [ ] Tests:
  - `src/components/guide/GuideNavRail.test.tsx` (chapter status rendering, scroll-to-chapter, guide-from-chapter, questions index jump, archived guides visibility).
  - `src/lib/assistant-sheet.test.ts`, `src/mobile/AssistantSheet.test.tsx`, `src/mobile/MobileApp.test.tsx`.

## Acceptance Criteria

- In desktop Guide mode, the left rail is a book-native navigation panel (chapter progress + side-question index + guide settings), completely free of chat-session lists.
- On mobile, users can cleanly switch between Guide and Ask inside `AssistantSheet`, and Book selection / `PageGuideCard` interactions route to the right tab every time.

## Comments
