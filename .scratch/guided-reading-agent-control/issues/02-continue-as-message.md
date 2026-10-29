# 02: Continue and picks as messages with a reading state

**Status:** resolved

**Blocked by:** 01

**What to build:** The reader's ways to move on become messages that ask the assistant for a step; every message in a Guided session carries the reading state.

- [x] `guideReadingState`: where the guide is (chapter, block) and the default next step, in every guided-session reading context
- [x] Continue after the first step sends "继续带读" with `guideRequest: {}`; the model may end the step at a natural break near the default
- [x] The first step and picks (picker, skim, skip, TOC, "guide up to here") send their label with `guideRequest: { step }`; `guideStepRequestFor` maps the step to exact `guide_step` arguments; a step no call can take is refused before anything is persisted
- [x] `guideRequest` is persisted on the user entry: shown as a step marker, not editable, resent on regenerate (old user-message steps regenerate as a request for the same step)
- [x] Requests replace the reader's page and selection in the reading context; side questions keep them

## Comments

- Tests: `guide.test.ts` (reading state; request mapping round-trips through `requestedGuideStep`), `embedded-runtime.guided.test.ts`, `ChatPanel.guided.test.tsx`.
- Not verified in the running app: whether real models call `guide_step` reliably on Continue.
