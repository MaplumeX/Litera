# 03: `GuideDocument` revision projection, tip recovery bar & latest-step undo

**Status:** resolved

**Blocked by:** 02

**What to build:** Project per-step revisions and tip metadata into `GuideDocument` (`src/lib/guide-document.ts`), replace chat-style failure cards and leftover bottom retry buttons with a clean Tip Recovery Bar (`GuideIncompleteStepCard.tsx` + `GuideWorkspace.tsx`), and wire latest-step undo so downstream consumers (`PageGuideCard`, export, search) automatically reflect the selected revision.

## Scope & Tasks

- [ ] **`GuideDocument` projection (`src/lib/guide-document.ts`):**
  - Extend `ProjectGuideDocumentInput` with `stepRevisions?: Readonly<Record<string, StepRevisionSnapshot>>` and `activeRevisionTarget?: { targetAnchorId: string; revisionId: string } | null`.
  - Extend `GuideStepNode` with:
    - `revisionAnchorId?: string` (stable spine entry ID anchoring revisions for this step).
    - `revisions: GuideStepRevisionOption[]` (ordered `[original, ...offSpineRevisions]`, each with `id`, `label`, `pace?`, `styleOverride?`, `modelId?`, `timestamp`, `isOriginal`).
    - `activeRevisionId: string` (`"__original__"` or active off-spine `revisionId`).
    - `isLatestStep: boolean` (true strictly for the final committed step on the spine when no uncommitted tail attempt sits after it—or when it is the spine tip step).
  - When a step has an active off-spine revision (or is currently streaming a revision), project that revision's `content`, `blocks`, `streaming`, `stopReason`, and `errorMessage` directly onto `step.explanation` / `step.blocks` / `step.streaming` / `step.stopReason` / `step.errorMessage`.
    - Because `step.explanation` reflects the active revision, `extractGuideProseSegments`, `formatGuideExportMarkdown` (`src/lib/guide-export.ts`), `searchGuideDocument`, Save-to-Note, and `PageGuideCard` automatically use the selected version.
  - Suppress empty historical `incompleteSteps` (failed/aborted attempts with no substantive content that are not at the active tail) from cluttering the timeline between committed steps.
- [ ] **Tip Recovery Bar (`src/components/guide/GuideIncompleteStepCard.tsx` & `GuideWorkspace.tsx`):**
  - Refactor `GuideIncompleteStepCard` for tail uncommitted attempts (`error` / `aborted` / `replied` without step) into a compact, document-native **Tip Recovery Bar**:
    - Remove the chat-style `< 1/2 >` `BranchSwitcher` from failed/aborted incomplete attempts.
    - Offer clear actions: **重试** (retry tail turn), **换模型重试** (optional quick model pick when multiple models are configured), and **放弃** (`dismissIncompleteTail`, rewinding the failed attempt cleanly off the active view).
    - Keep streaming pre-tool / partial prose body expandable when present.
  - Remove the leftover chat-panel bare `RefreshCw` fallback button at the bottom of `GuideWorkspace.tsx` (lines ~1274–1292).
- [ ] **Latest-step undo wiring (`src/components/guide/GuideStepSection.tsx` & `GuideWorkspace.tsx`):**
  - Expose an `onUndoLatestStep` callback strictly when `node.isLatestStep && !isStreaming && !readOnly` (rendered cleanly in the step's action menu / header), invoking `bridge.undoLatestStep()` so `GuideBar` immediately returns to the pre-step cursor for range re-picking.
- [ ] **i18n & tests:**
  - Add Simplified Chinese (`src/locales/zh-CN.ts`) and English (`src/locales/en.ts`) strings for tip recovery actions (`放弃`, `换模型重试`, `撤销这一步`).
  - Update `src/lib/guide-document.test.ts` and `src/lib/guide-export.test.ts` to verify revision projection, active revision override in export/search, empty historical incomplete step suppression, and `isLatestStep` accuracy.
  - Update `src/components/guide/GuideWorkspace.test.tsx` for Tip Recovery Bar retry/dismiss and latest-step undo.

## Acceptance Criteria

- `npx vitest run src/lib/guide-document.test.ts src/lib/guide-export.test.ts src/components/guide/GuideWorkspace.test.tsx` passes.
- Failed/aborted tail attempts show no `< 1/2 >` switcher and disappear cleanly when dismissed or retried successfully.
- Exporting Markdown or searching the guide always matches the currently selected step revision.

## Comments
