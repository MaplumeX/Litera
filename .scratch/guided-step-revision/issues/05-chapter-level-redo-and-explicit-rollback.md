# 05: Chapter-level re-read grouping, explicit rollback dialog & domain doc update

**Status:** resolved

**Blocked by:** 02, 04

**What to build:** Add first-class chapter-level actions to `GuideChapterBar` (non-destructive chapter re-reading with folded pass selection + confirmation-gated explicit rollback to a chapter), and update `CONTEXT.md` to document the off-spine step-revision invariant.

## Scope & Tasks

- [ ] **Fold repeated chapter runs in `GuideChapterBar` (`src/components/guide/GuideChapterBar.tsx`):**
  - When a Book chapter has multiple `GuideChapterRun`s (initial read + one or more `isReread` passes), group them under a single chapter row in the `GuideChapterBar` switcher dropdown instead of duplicating rows with flat `重读` badges.
  - Show a compact pass indicator / inline pass pills (`第 1 遍` / `第 2 遍`) when viewing or selecting a chapter that has been read multiple times, while keeping prev/next chapter navigation intuitive and search hits jumping to the exact run.
- [ ] **Chapter action menu (`···`) in `GuideChapterBar` / `GuideChapterGroup`:**
  - Add a quiet `···` menu button (hidden when read-only / viewing archived guide, disabled while streaming) with two clearly separated chapter-level actions:
    1. **「重读本章」 (Re-read chapter — non-destructive):**
       - Starts a fresh guided pass from the start of `activeRun`'s chapter (reusing `guideChapter` / `stepAtHref`, optionally allowing pace selection) **without** disturbing later chapters or moving `Guide cursor` backward.
    2. **「从本章重新继续」 (Rollback to this chapter — explicit destructive action):**
       - Shown when `activeRun` is not empty (and clearly styled as a destructive/caution action separated by a divider).
       - Opens a confirmation dialog explicitly naming the chapter and the number of subsequent chapters that will be hidden from the active spine (e.g. "将回退到《第 3 章》之前，后续 3 章的当前进度将从主线隐藏，但仍保留在会话历史分支中").
       - On confirm, invokes `bridge.rollbackToChapterRun(activeRun.anchorEntryId)`, then optionally offers/triggers immediate start of that chapter so the reader is not stranded on an empty screen.
- [ ] **Mobile adaptation check (`src/mobile/AssistantSheet.tsx`):**
  - Verify `GuideChapterBar` in `compact` mode fits comfortably on narrow mobile screens (no clipping of chapter title, latest badge, and `···` button).
- [ ] **Domain documentation (`CONTEXT.md`):**
  - Update **Guided session** and **Guided step** entries in `CONTEXT.md` to reflect that single-step re-explanations are stored as off-spine step revisions anchored to the step (without moving `Guide cursor` or rewinding later chapters), and that spine rollback is an explicit chapter-level or tip-undo operation.
- [ ] **i18n & tests:**
  - Add Simplified Chinese (`src/locales/zh-CN.ts`) and English (`src/locales/en.ts`) strings for chapter menu items, pass labels (`第 {n} 遍`), and the rollback confirmation dialog.
  - Add tests in `src/components/guide/GuideWorkspace.test.tsx` (and/or `GuideChapterBar.test.tsx`) covering:
    - Repeated chapter runs fold cleanly in `GuideChapterBar` and allow switching between passes.
    - Non-destructive "重读本章" triggers `guideChapter` without confirmation and preserves later runs.
    - Destructive "从本章重新继续" requires confirmation, displays the exact count of affected downstream chapters, and invokes `rollbackToChapterRun` only after confirm.

## Acceptance Criteria

- `npx vitest run src/components/guide/` passes.
- `npm run build` / TypeScript typecheck passes cleanly.
- `CONTEXT.md` accurately matches the implemented Guided session & Guided step invariants.

## Comments
