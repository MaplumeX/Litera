# Spec: The agent takes guided steps itself

Status: resolved

## Problem Statement

A Guided session is driven by the runtime, not the model:

- Every step is a user message carrying `guide`, written by the UI. The runtime turns it into a reading context that spells out the exact `read_chapter` calls; the model only executes them.
- When the reader asks "带读第3章", the model may not read it: `guide_step` queues the step, the model says one line and stops, and the UI sends the step as a second prompt (`prompt_end.guideStep` → reducer → `ChatPanel`).
- The mode lives in prose: the guided prompt explains that messages without a step are side questions "with one exception", and lists rules (no mid-chapter start, how to count chapters and paragraphs) that the tools already enforce or belong to the tools.

## Solution

`guide_step` becomes the one way the guide moves on, called by the model in the turn that retells the step.

1. **A step is taken in the turn.** `guide_step` records the step and returns what to read (the reads `guideStepContext` lists today). The model reads and retells it in the same reply. The step is persisted as `guide` on the tool result's message entry, so "a step is a message entry with `guide`" still holds: `guideCursor`, the Rust summary's `latest_guide_on_branch`, coverage, marks and recaps work unchanged. `guidedTurns` starts a turn at any entry with `guide`. Old sessions (steps on user entries) read as before. Several calls in one reply take consecutive steps. The queue (`requestedStep`, `prompt_end.guideStep`, `guide_step_requested`, `requestedGuideStep`) goes.
2. **Continue is a message.** In a Guided session every turn's reading context carries a reading state: where the guide is and the default next step. Continue sends "继续" with `guideRequest: {}`; the model calls `guide_step` and may end the step at a nearby natural break instead of the default. A step the reader picked (picker, skim, skip, TOC, "guide up to here") sends its label with `guideRequest: { step }`; the reading context gives the exact `guide_step` arguments. `guideRequest` is on the user entry only to show the message as a step marker and to resend it; it is not a step.
3. **Rules live in the tools.** The guided prompt keeps the role, the style, skimming and recaps, and says only that `guide_step` is how the guide moves on. How to find chapters and paragraphs moves into the `guide_step` and `list_guide_blocks` descriptions; the tool's errors keep the no-gap, no-mid-chapter rules.

## Decisions

1. **Where the step is persisted.** _Decided: `guide` on the tool result entry._ Keeps every consumer of "message entry with `guide`" unchanged, including the Rust summary; no new entry type.
2. **Picked steps.** _Decided: exact `guide_step` arguments in the reading context._ The reader chose the range; only Continue leaves the end to the model.
3. **When the model takes no step.** Accepted: a Continue answered without `guide_step` does not move the guide; the reader can press Continue again. Not enforced by the runtime.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | `guide_step` takes the step in the turn | resolved | — |
| 02 | Continue and picks as messages with a reading state | resolved | 01 |
| 03 | Guided prompt: rules move into the tools | resolved | 01 |

## Out of Scope

- Recaps written by the agent (still a background call).
- Enforcing that a Continue turn takes a step.
- Migrating old sessions (they keep working as recorded).
