# 02: Runtime & `GuideController` support for step revision, tip undo, and chapter rollback

**Status:** resolved

**Blocked by:** 01

**What to build:** Implement the four runtime operations in `LiteraAgentRuntime` (`src/agent/runtime/embedded-runtime.ts`), expose them cleanly through `GuideController` (`src/agent/runtime/guide-controller.ts`) and `useGuideBridge` (`src/lib/use-guide-bridge.ts`), and extend `agent-reducer.ts` to handle live off-spine revision streaming and selection state.

## Scope & Tasks

- [ ] **Event contract & reducer (`src/types/agent.ts`, `src/lib/agent-reducer.ts`):**
  - Extend `PromptCorrelation` (or add `stepRevisionTarget?: { targetAnchorId: string; revisionId: string }`) and session-snapshot event payloads (`stepRevisions?: Record<string, StepRevisionSnapshot>`).
  - Track `stepRevisions` and `activeRevisionTarget` in `AgentState` (`agent-reducer.ts`) so streaming deltas (`text_delta`, `thinking_*`, `tool_*`) update the target `GuideStepSection` in place without mutating `state.messages` or jumping scroll focus.
- [ ] **In-place step revision (`embedded-runtime.ts`):**
  - Track `selectedStepRevisions: Map<string, string>` per open session (defaulting to newest non-empty revision, or `"__original__"` when the reader explicitly selects the original spine explanation; cleared on `switchSession` / book change).
  - Add `reviseGuidedStep(targetAnchorId, options: { pace?: GuideStepPace; styleOverride?: string; modelOverride?: { provider: string; model: string } }, promptId?, requestId?)`:
    - Resolve the target spine step's recorded `RecordedGuideStep` (`from..to` span) and verify it belongs to the active spine of the current Guided session.
    - Build an ephemeral `Agent` initialized from `stepRevisionContextEntries(session, targetAnchorId, this.selectedStepRevisions)` using `modelOverride` (if provided) or the current config model.
    - Read the pinned `from..to` Book blocks directly via `BookContentPort` and inject them into the revision user turn along with `pace` and `styleOverride` instructions; **do not expose `guide_step`** so the model cannot alter step boundaries or move `Guide cursor`. Keep read-only reference tools (`read_chapter`, `search_in_book`, `draw_mindmap`, etc.) available if needed.
    - Persist the resulting assistant message(s) as off-spine JSONL entries tagged with `stepRevision: { targetAnchorId, revisionId, pace, styleOverride, modelId, provider }` and `parentId: targetAnchorId`. Never overwrite `session.leafId`.
    - Update `selectedStepRevisions.set(targetAnchorId, revisionId)` on success and emit `prompt_end` / `prompt_aborted` carrying updated `stepRevisions`.
    - If the revised step belongs to a chapter that already has a `Chapter recap` on the spine, trigger a silent background `Chapter recap` refresh using the chapter's updated active explanations (without blocking the turn or disturbing spine Prompt Cache).
  - Add `selectStepRevision(sessionId, targetAnchorId, revisionId, requestId?)`: updates `selectedStepRevisions` (allowing `"__original__"` to view the spine original), invalidates cached spine/side-thread agents if affected, and emits updated `stepRevisions`.
- [ ] **Tip-only undo & incomplete tail dismiss (`embedded-runtime.ts`):**
  - Add `undoLatestGuidedStep(sessionId, requestId?)`: validates that the active spine ends with a committed `Guided step` turn, rewinds `session.leafId` to the entry immediately before that turn's user request (via `sessions.setLeaf`), clears `this.agent`, and emits `branch_switched` with updated messages/navigation/sideThreads/stepRevisions. Rejects if streaming or if no committed step exists.
  - Add `dismissIncompleteTailStep(sessionId, requestId?)`: validates that the active spine tail is an uncommitted `guideRequest` attempt (error, aborted, or replied without calling `guide_step`), rewinds `session.leafId` back to the last entry before that uncommitted request, and emits `branch_switched`.
- [ ] **Explicit chapter rollback (`embedded-runtime.ts`):**
  - Add `rollbackToChapterRun(sessionId, runAnchorEntryId, requestId?)`: locates the `GuideSpineRunInfo` owning `runAnchorEntryId`, rewinds `session.leafId` to the entry immediately before `runAnchorEntryId` (or `null` if it is the first run), and emits `branch_switched` so the reader can explicitly restart from that chapter while preserving the old path in JSONL.
- [ ] **Controller & Bridge wiring (`src/agent/runtime/guide-controller.ts`, `src/lib/use-guide-bridge.ts`):**
  - Expose `reviseStep`, `selectStepRevision`, `undoLatestStep`, `dismissIncompleteTail`, and `rollbackToChapterRun` on `GuideController` and `useGuideBridge`.
- [ ] **Tests:**
  - Add runtime tests in `src/agent/runtime/embedded-runtime.guided.test.ts` covering:
    - Historical chapter step revision keeps `session.leafId`, `Guide cursor`, later chapters, and chapter `sideThread` intact.
    - Pinned span text is injected and `guide_step` is absent during revision.
    - `pace`, `styleOverride`, and `modelOverride` are applied and persisted in `stepRevision` metadata.
    - `selectStepRevision` switches active revision (including back to `"__original__"`) and affects subsequent `sideThread` context.
    - Background `Chapter recap` refreshes after revising a step in an already-recapped chapter.
    - `undoLatestGuidedStep` and `dismissIncompleteTailStep` rewind exactly one tail turn; `rollbackToChapterRun` rewinds to before the target chapter run.
  - Add reducer tests in `src/lib/agent-reducer.test.ts` for streaming revision deltas and state reset on completion/abort/error.

## Acceptance Criteria

- `npx vitest run src/agent/runtime/embedded-runtime.guided.test.ts src/agent/runtime/guide-controller.test.ts src/lib/agent-reducer.test.ts` passes.
- Revising a step in Chapter 2 while `Guide cursor` is in Chapter 5 never changes `session.leafId`, never removes Chapters 3–5, and never detaches Chapter 2's `sideThread`.

## Comments
