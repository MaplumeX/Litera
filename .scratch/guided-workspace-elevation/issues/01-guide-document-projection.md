# 01: `GuideDocument` pure projection model

**Status:** resolved

**Blocked by:** —

**What to build:** Introduce a single, pure, strongly typed read model (`GuideDocument`) that projects a Guided session's active branch transcript (`AgentMessage[]`, branch anchors/navigation) + Book TOC into chapter-grouped sections, steps, anchored side-threads, and cursor/progress metadata—eliminating duplicate ad-hoc scans across `ChatPanel`, `guide-step-cards.ts`, and `ChatOutlineRail`.

## Scope & Tasks

- [ ] Define `GuideDocument` domain types in `src/lib/guide-document.ts`:
  - `GuideSideQaNode`: `{ id: string; userMessageIndex: number; assistantMessageIndex?: number; question: string; selection?: string; answer: string; blocks?: AssistantBlock[]; streaming?: boolean; stopReason?: "aborted" | "error"; errorMessage?: string; branchAnchorId?: string }`
  - `GuideStepNode`: `{ stepIndex: number; id: string; step: RecordedGuideStep; label: string; skim: boolean; chapterIndex: number; endChapterIndex: number; messageIndex: number; requestMessageIndex?: number; toolCallId?: string; explanation: string; blocks?: AssistantBlock[]; streaming?: boolean; stopReason?: "aborted" | "error"; errorMessage?: string; branchAnchorId?: string; sideThreads: GuideSideQaNode[] }`
  - `GuideChapterNode`: `{ chapterIndex: number; title: string; href: string; totalBlocks: number; coveredBlocks: number; status: "unread" | "in_progress" | "skimmed" | "completed"; isCurrent: boolean; steps: GuideStepNode[] }`
  - `GuideTimelineEvent`: lightweight markers (`guide_cut`, `compaction` notice) attached with position indices so `GuideWorkspace` can still render manual context-cut / compaction dividers in place.
  - `GuideDocument`: `{ bookId: string; sessionId: string | null; chapters: GuideChapterNode[]; steps: GuideStepNode[]; orphanSideThreads: GuideSideQaNode[]; markers: GuideTimelineEvent[]; hasStarted: boolean; coveredChapters: number; totalNonEmptyChapters: number }`
- [ ] Implement pure function `projectGuideDocument(input)`:
  - Handles modern `guide_step` tool-call steps (including multi-step turns and in-flight streaming `guide_step` placeholders).
  - Handles legacy user-message `message.guide` steps and `LegacyGuideStep` part-based steps seamlessly.
  - Associates non-`guideRequest` / non-`guide` user Q&As with the most recent preceding `GuideStepNode` as `sideThreads` (and captures pre-first-step questions in `orphanSideThreads` so nothing is ever lost).
  - Preserves exact `messageIndex` / `branchAnchorId` mapping so edit, regenerate, branch-switch, and `PageGuideCard`'s "Open in guide" work identically.
- [ ] Re-export or adapt `extractGuideStepCards()` (`src/lib/guide-step-cards.ts`) to derive from `GuideDocument` (or share the exact step-grouping core) so `PageGuideCard` and `GuideWorkspace` never disagree on `stepIndex`.
- [ ] Write thorough unit tests in `src/lib/guide-document.test.ts`:
  - Empty / unstarted session, single chapter multi-step, cross-chapter step, skim step, re-read of an earlier chapter (verifying `Guide cursor` stays at furthest point).
  - Side questions before first step, between steps, streaming in-progress side question, aborted/error assistant replies.
  - Legacy `message.guide` and `LegacyGuideStep` compatibility.
  - Branch anchor preservation on both step requests and side questions, plus `guide_cut` / `compaction` divider placement.

## Acceptance Criteria

- `projectGuideDocument` is 100% pure (no Tauri/DOM/runtime side effects) and deterministic.
- Existing `src/lib/guide-step-cards.test.ts` (if present) and all new `guide-document.test.ts` tests pass via `npx vitest run`.

## Comments
