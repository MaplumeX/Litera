# 05: Overflow recovery and failure state

**Status:** resolved
**Blocked by:** 04

**What to build:** A request that overflows the context window is compacted and retried once instead of failing.

- [x] On an assistant result where `isContextOverflow` is true: discard it, force prune + compact (ignore thresholds), rebuild agent messages, retry the same prompt once
- [x] The overflowed assistant message is not persisted; the user message is not duplicated
- [x] Second overflow or compaction failure surfaces the existing prompt error
- [x] Failed background compaction emits `compaction_failed` with a non-blocking UI state; next turn tries again
- [x] Tests: overflow → compact → successful retry; overflow → compaction fails → error

## Comments

- The retry emits `retry_scheduled` (attempt 1/1, no delay) so the reducer drops a partially streamed bubble. Only `error` / `length` overflows are retried; a silent overflow (`stop` with oversized usage) already has an answer and is handled by the post-turn maintenance.
