# 05: Guide progress in the TOC

**Status:** resolved

**What to build:** When a Guided session is active, the Agent-mode TOC scope panel marks each chapter: retold, skimmed, in progress (with part n/m), or not yet. Clicking a chapter in a Guided session offers "Continue from here", which moves the cursor.

- [x] Progress derived from the active branch's guided steps; no persistence
- [x] Ordinary Sessions show the TOC as today
- [x] Tests: progress derivation from a sequence of steps

## Comments

- No separate "Continue from here" item: in a Guided session, picking a chapter in the TOC (which sets the scope) makes the Continue button start there. Nothing is persisted until it is sent, as with Skip. Only a fresh pick counts; a scope left over from before switching into the session is ignored.
- Marks: ✓ done, 略/Skim skimmed, `n/m` part-way, a dot on the current chapter. Derived in `guideTocProgress` from the active branch's steps; ChatPanel reports the steps up through `onGuideStepsChange`.
- Desktop Agent mode only. The mobile TOC does not show marks yet.
