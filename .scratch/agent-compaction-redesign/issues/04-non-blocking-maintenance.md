# 04: Non-blocking, abortable post-turn maintenance

**Status:** resolved
**Blocked by:** 02

**What to build:** Move prune/compact off the reader's critical path.

- [x] Post-turn: emit `prompt_end` / `prompt_aborted` first (input unlocks), then run maintenance in the background
- [x] Maintenance has its own `AbortController`; `abort()`, `openBook`, `closeBook`, session switch and `invalidateConfig` abort it; `generateSummary` receives the signal
- [x] A prompt submitted while maintenance runs awaits it before building context (maintenance never runs concurrently with a prompt)
- [x] Pre-prompt: prune synchronously if needed; compact only when the context would not fit `compactAt` (e.g. switched to a smaller model)
- [x] Events carry enough correlation for the UI to show progress outside an active prompt (`compaction_started/completed/failed` no longer require a live `promptId` match)
- [x] Stale-leaf safety: a maintenance append whose leaf moved (branch switch, edit) is discarded, like `maybeGenerateTitle`
- [x] Tests: input unlocked before compaction finishes; abort during compaction persists nothing; prompt during maintenance waits

## Comments

- `compaction_completed` carries the visible projection, so the notice appears without waiting for the next prompt; during a prompt the reducer keeps the in-flight transcript and lets `prompt_end` deliver it.
- `LiteraAgentRuntime.settled()` awaits background maintenance (used by tests).
- First-turn title generation now tolerates maintenance entries appended after the answer (`onlyMaintenanceSince`).
