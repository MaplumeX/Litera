# 04: Intentful re-explain popover & semantic per-step version switcher

**Status:** resolved

**Blocked by:** 03

**What to build:** Replace the bare `RefreshCw` retry button on `GuideStepSection` with an intent-driven **Re-explain Popover** (`pace`, optional model override, 1-line `styleOverride` instruction, and 1-click default re-explain) and a **local semantic version switcher** (`原版` / `深入` / `精简 · Model` / `“多举例子”`), keeping `GuideWorkspace` anchored on the viewed chapter throughout revision.

## Scope & Tasks

- [ ] **Create `GuideStepReexplainPopover` (`src/components/guide/GuideStepReexplainPopover.tsx`):**
  - Triggered from `GuideStepSection`'s header icon (`RefreshCw` / `Sparkles` subtle button).
  - Compact popover layout:
    1. **1-click primary row:** `原样重新讲解` (re-explains with the same pace/model, pinned to this step's `from..to` span).
    2. **Depth quick-pills (`pace`):** `精简` / `标准` / `深入` — highlights the active revision's pace; clicking another pace immediately starts an in-place revision with that `pace`.
    3. **Model selector (when configured models > 1):** Compact select listing available models so the reader can re-explain this single step with another model.
    4. **Custom instruction input (`styleOverride`):** Single-line input (`告诉助手怎么重讲，如：多举例子、逐句拆解…`) with Enter-to-submit; closes popover on submit and streams in place.
    5. **Tip-only footer action (strictly when `node.isLatestStep`):** Subtle `撤销这一步并重选范围` action separated by a divider.
- [ ] **Local semantic version switcher (`src/components/guide/GuideStepSection.tsx`):**
  - When `node.revisions.length > 1`, render a compact version selector pill in the step header (e.g. `v2 · 深入 ▾` or `v2 · “多举例子” ▾`) opening a popover/dropdown listing every revision with its semantic label (`原版`, `深入`, `精简 · Sonnet`, truncated `styleOverride`) and a checkmark on `activeRevisionId`.
  - Selecting a revision calls `onSelectRevision(node.revisionAnchorId, revision.id)` — updating **only that step** with zero page jump and zero spine mutation.
  - Keep legacy `BranchSwitcher` visible *only* if the step has a legacy spine fork (`node.branchInfo`), with a clarifying tooltip indicating it switches a historical timeline branch so users never confuse legacy timeline forks with local step revisions.
- [ ] **Wire into `GuideWorkspace` & `GuideChapterGroup`:**
  - Route step re-explain actions on `GuideStepSection` to `bridge.reviseStep(node.revisionAnchorId, options)` instead of `handleRegenerate` (spine rewind).
  - **Stay on the viewed chapter:** Never call `focusRun(null, ...)` during `reviseStep`; scroll gently to keep the target `GuideStepSection` in view if needed.
  - Ensure `GuideControlDock` and other steps disable concurrent mutations cleanly while `isStreaming` is true, and aborting a revision leaves the previous revision cleanly recoverable.
- [ ] **i18n & tests:**
  - Add Simplified Chinese (`src/locales/zh-CN.ts`) and English (`src/locales/en.ts`) labels for the re-explain popover, version pills, and legacy branch tooltip.
  - Add unit/component tests in `src/components/guide/GuideStepReexplainPopover.test.tsx` and extend `src/components/guide/GuideWorkspace.test.tsx` to verify:
    - Clicking "深入" or submitting a `styleOverride` in Chapter 1 invokes `reviseStep` with the exact options, stays on Chapter 1, and never calls spine `regenerateTurn`.
    - Switching between `原版` and `深入` updates only that step's content and does not change the active chapter run or later chapters.
    - `撤销这一步` renders only on the latest step and never on historical steps.

## Acceptance Criteria

- `npx vitest run src/components/guide/GuideStepReexplainPopover.test.tsx src/components/guide/GuideWorkspace.test.tsx` passes.
- Re-explaining any historical step never jumps out of the viewed chapter and never hides later chapters.
- Both desktop `GuideWorkspace` and Android `AssistantSheet` (which hosts `GuideWorkspace`) render the popover cleanly without overflow on narrow viewports.

## Comments
