# 03: Shared assistant primitives & `ChatWorkspace` extraction

**Status:** resolved

**Blocked by:** —

**What to build:** Decompose the ~1150-line `src/components/chat/ChatPanel.tsx` by extracting reusable assistant/session primitives into a clean shared layer and isolating pure free-form Q&A into `ChatWorkspace`, preparing the ground for a clean `GuideWorkspace` without code duplication.

## Scope & Tasks

- [ ] Audit and organize shared primitives (either under `src/components/assistant/` or clearly separated modules exported via an index) used by both free-form Q&A and Guided reading:
  - Message & content rendering: `AssistantMessage`, `MarkdownText`, `Citation` (`CitationContext` + cached `useCitationActions(bookId, locateQuote, onOpenQuote)` hook), `MindmapCard`, `AnswerProcess`, `ToolCallCard`, `CompactionNotice`, `CompactionStatus`, `TypingIndicator`, `HoldHeight`.
  - Interactive controls: `BranchSwitcher`, `ModelSwitcher`, `ChatInput`, `AgentConfigDialog`, `SessionConfigDialog`, `ChatOutlineRail`.
- [ ] Extract shared scroll & outline-tracking behavior from `ChatPanel.tsx` into a reusable hook (e.g. `src/lib/use-transcript-scroll.ts`):
  - Handles `stickToBottom`, `suspendBottomFollowRef`, `scrollToBottom`, `scrollToItem(id/index)`, and `activeOutlineItem` calculation on scroll.
- [ ] Extract shared model/thinking/config orchestration hook (e.g. `src/lib/use-assistant-model-controls.ts`) wrapping `useAgentConfig`, `handleModelSelect`, `handleThinkingLevelChange`, and error surfacing.
- [ ] Extract pure `ChatWorkspace` component (`src/components/chat/ChatWorkspace.tsx`):
  - Handles ordinary multi-session Q&A (`SessionList`, `MessageBubble`, editing user messages, regenerating, branching, `EmptyState`, docked vs workspace layout).
  - Contains **zero** `isGuided` branches, `GuideBar`, `GuideRangePicker`, `GuideStepMarker`, or `GuideStepImages`.
- [ ] Keep `ChatPanel.tsx` as a thin compatibility wrapper (or delegate to `ChatWorkspace` when `!isGuided` and legacy guided path until Issue 04 replaces it) so no existing callers break during the transition.
- [ ] Tests:
  - Unit tests for `useTranscriptScroll` and `useCitationActions`.
  - Ensure all existing `ChatPanel*.test.tsx` tests continue to pass without regression.

## Acceptance Criteria

- `ChatWorkspace.tsx` handles all ordinary Q&A functionality cleanly with no guided-reading conditionals.
- Shared primitives (`CitationContext`, scroll-follow hook, model controls) are cleanly reusable by `GuideWorkspace` in Issue 04.

## Comments
