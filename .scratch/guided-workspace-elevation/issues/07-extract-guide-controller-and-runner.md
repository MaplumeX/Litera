# 07: Extract `AgentTurnRunner`, `GuideController`, and `useGuideBridge`

**Status:** resolved

**Blocked by:** 02, 04

**What to build:** Split the monolithic `src/agent/runtime/embedded-runtime.ts` into a shared turn-execution engine (`AgentTurnRunner`), a dedicated `GuideController` owning all Guided reading workflows, and a lean `ChatController` for ordinary Sessions—with matching `useGuideBridge` and `useChatBridge` React hooks.

## Scope & Tasks

- [ ] Extract `src/agent/runtime/turn-runner.ts` (`AgentTurnRunner`):
  - Encapsulates model resolution (`resolveRuntimeModel`), guarded native fetch, streaming execution, retry scheduling, abort handling, tool execution loop, and shared Book tools (`get_toc`, `read_chapter`, `search_in_book`, `view_image`, `draw_mindmap`, `list_annotations`).
  - Accepts per-controller prompt builder, extra tool definitions, and post-turn maintenance hooks.
- [ ] Extract `src/agent/runtime/guide-controller.ts` (`GuideController`):
  - Owns the open Book's canonical Guided session lifecycle (discover/create canonical session, archive & restart, inspect archived legacy sessions read-only).
  - Owns all guided domain operations: `continue()`, `takeStep(span, options?)`, `skim()`, `skipChapter()`, `guideToSelection()`, `guideChapter()`, `askSideQuestion()`, `regenerateAt()`, `switchBranch()`, `resetContext()`, `guideOutline()`, `guideStepAnchor()`, `guideStepImages()`, `readStepImageUrl()`, `guideContextStats()`.
  - Owns guided-specific tools (`guide_step` with inline text & vision hints, `list_guide_blocks`, `search_guide_history`) and post-turn background maintenance (silent `Chapter recap` generation + coherence-leaning sliding window `guide_window_cut` + non-adjacent jump cut).
  - Publishes typed `GuideState` / `GuideEvent` updates independently of ordinary chat session switching (so running a quick Q&A in `Agent` mode never evicts or resets `GuideController`'s loaded canonical session).
  - Coordinates safely with `ChatController` if a turn is active on one side (e.g., serializing shared Book worker / session file writes cleanly without race conditions).
- [ ] Slim down `src/agent/runtime/embedded-runtime.ts` (or `ChatController`):
  - Remove the ~15 `guide*` methods and `if (session.header.kind === "guided")` branches from the general chat flow.
  - Keep a clean facade or explicit exports (`chatRuntime`, `guideController`) and remove obsolete glue from `src/lib/use-agent-bridge.ts` in favor of `useChatBridge(bookId)` and `useGuideBridge(bookId)`.
- [ ] Update `useGuideDocument` and `GuideWorkspace` to bind directly to `useGuideBridge(bookId)`.
- [ ] Tests:
  - Migrate and verify all existing `src/agent/runtime/embedded-runtime*.test.ts` suites (especially `embedded-runtime.guided.test.ts`, `branch`, `edit`, `images`, `sync`).
  - Add dedicated `src/agent/runtime/guide-controller.test.ts` testing independent canonical Guide state while ordinary chat switches sessions.

## Acceptance Criteria

- Ordinary chat runtime (`ChatController` / `useChatBridge`) has zero guided-reading conditionals or `guide*` APIs.
- `GuideController` can load, step, maintain sliding context + silent recaps, and publish `GuideDocument` independently of which ordinary Session is open in `Agent` mode.
- All unit and integration tests pass with zero regressions.

## Comments
