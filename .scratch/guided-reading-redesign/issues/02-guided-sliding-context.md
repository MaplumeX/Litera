# 02: Guided sliding context window, jump clear, and manual reset

**Status:** resolved

**Blocked by:** 01

**What to build:** Replace high-watermark generic Compaction as the routine context manager in Guided sessions with a coherence-leaning, zero-LLM-call sliding context window relayed by `Chapter recap`, plus automatic clearing on non-adjacent chapter jumps and a manual reset divider.

- [x] Append-only session entry `guide_window_cut`: `{ type: "guide_window_cut", firstKeptEntryId: string, reason: "batch" | "jump" | "manual" }` decoded in `pi-session.ts` (compatible with existing JSONL sync)
- [x] `contextBranch()` projection for Guided sessions: apply the latest `guide_window_cut` (when newer than any `compaction`), projecting `[bookSnapshot, ...all earlier guideRecap entries on branch, ...entries from firstKeptEntryId onward]`
- [x] Aggressive book-text pruning inside Guided sessions: clear prunable tool results (`read_chapter`, `list_guide_blocks`, inline text of `guide_step`) older than the latest completed step without breaking Prompt Cache prefix during normal turns (triggered alongside batch advance or existing `pruneAt`)
- [x] Coherence-leaning batch advance in `maintainContext` (Guided sessions only):
  - Ceiling target ~35k tokens (configurable constant scaled cleanly for smaller context windows)
  - When exceeded, advance `firstKeptEntryId` to keep the latest 2–3 guided turns intact (allowing overlap across chapter boundaries), only dropping turns belonging to chapters that already have a `Chapter recap` (or are skipped)
  - Generic Compaction remains as fallback if a single un-recapped chapter alone exceeds `compactAt`
- [x] Non-adjacent chapter jump auto-clear: when a `guide_step` targets a chapter not adjacent to the previous guided step's chapter (ignoring empty chapters with `chars === 0`), append a `guide_window_cut` (`reason: "jump"`) so the new chapter runs with `bookSnapshot` + existing `Chapter recaps` only
- [x] Manual reset & compact context indicator:
  - Subtle context indicator in the guide header (tooltip/popover showing loaded recaps count & active window token estimate)
  - One-click "Collapse context (keep recaps)" action that appends a `guide_window_cut` (`reason: "manual"`) and renders a collapsible/subtle transcript divider
- [x] Tests: `pi-session.test.ts`, `compaction.test.ts`, `embedded-runtime.guided.test.ts` (batch advance keeps 2–3 steps, preserves all recaps, jump auto-clear, manual reset divider, fallback compaction)

## Comments
