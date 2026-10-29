# 02: `guide_step` tool, sent as a follow-up step

**Status:** resolved

**Blocked by:** —

**What to build:** A model tool, only in Guided sessions, that asks for a guided step. When the turn ends, the step is sent as an ordinary guided step (a user message with `guide`), through the same path as Continue.

- [x] Tool `guide_step({ chapterIndex?, toChapterIndex?, toBlock?, skim? })`, registered only when the Session is guided
- [x] Start: `chapterIndex` → that chapter's first block (`nextGuideStep(toc, null, chapterIndex)`, as `guideStepAt`); none → `nextGuideStep` from the Guide cursor
- [x] End: `toBlock` (in `toChapterIndex`, default the start chapter) → `guideStepTo`; `toChapterIndex` alone → that chapter's last block; none → the default step (one part). `skim` → `guideStepTo(…, true)` or `skimGuideStep`
- [x] No mid-chapter start: the tool has no `fromBlock`; the description says so
- [x] Errors the model can act on: unknown chapter, block outside the chapter, end before start, end of the Book, not a Guided session
- [x] Result: the queued step and a note to reply with one short line and stop
- [x] The runtime keeps the latest requested step of the turn; `prompt_end` carries it as `guideStep` unless the turn ended in an error (an aborted turn emits `prompt_aborted`, without it). `ChatPanel` sends it with `sendGuideStep`, desktop and mobile. A later call replaces an earlier one
- [x] The turn with the tool call stays a side question (no `guide` on its user message)
- [x] Tests: see Comments

## Comments

- Pure builder `requestedGuideStep(toc, cursor, request)` in `guide.ts`, returning `{ step }` or `{ error }`; the tool throws the error so the model sees an error result.
- `toChapterIndex` without `toBlock` means "to that chapter's end", so "带读第3章" is `{ chapterIndex: 3, toChapterIndex: 3 }`, and a chapter cut into TOC sub-sections can end at its last sub-section.
- Hand-over: `prompt_end.guideStep` → `use-agent-bridge` dispatches `guide_step_requested` only after its post-prompt `switchSession` (history restore) resolves; sending earlier let the restore's `session_switched` land on top of the new prompt (it resets `promptId` and messages). The reducer keeps `requestedGuideStep` for its Session, and clears it on `prompt_queued`, a new Session or a switch to another Session. `ChatPanel` sends it once (ref guard), only when not streaming and in that Guided session.
- Answer process shows the call as "安排下一步带读" / "Queued the next guided step" (ListEnd icon). It is not a lookup, so the sources summary ignores it (except as a failed call).
- Tests: `guide.test.ts` (builder), `embedded-runtime.guided.test.ts` (tool only in Guided sessions, hand-over on `prompt_end`, later call wins, user entry has no `guide`, cursor start, errors, abort), `agent-reducer.test.ts`, `use-agent-bridge.test.ts` (hand-over after restore), `ChatPanel.guided.test.tsx` (sent once; not while answering or for another Session).
- Not verified in the running app.
