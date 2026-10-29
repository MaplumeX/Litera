# 01: `guide_step` takes the step in the turn

**Status:** resolved

**Blocked by:** —

**What to build:** The model's `guide_step` call is the step: it records it, returns what to read, and the model explains it in the same reply. No follow-up prompt.

- [x] `guide_step` returns `guideStepContext` (the reads); the runtime keeps the steps taken in the running attempt (`turnSteps`, reset per attempt and at the end of the prompt)
- [x] The step is persisted as `guide` on its tool result's message entry; `guideCursor`, the Rust summary and coverage read it unchanged
- [x] `guidedTurns` starts a turn at any entry with `guide`; the text before the call is not part of the step's explanation
- [x] Several calls in one reply take consecutive steps (calls run one at a time, each from the cursor the one before left)
- [x] `visibleMessages` puts the step on the tool call (`AgentToolCall.guide`); `takenGuideSteps` reads steps from transcripts, old (user `guide`) and new
- [x] Removed: `requestedStep`, `prompt_end.guideStep`, `guide_step_requested`, `requestedGuideStep` and ChatPanel's send-once effect
- [x] Answer process: "带读这一步" with the step's label

## Comments

- Tests: `embedded-runtime.guided.test.ts` (step on the tool result, consecutive steps, cursor start, errors, range snippets, recaps), `pi-session.test.ts` (cursor, turns and tool-call guide from tool results).
- A step taken in a turn that is then aborted still counts, as a sent step did before.
