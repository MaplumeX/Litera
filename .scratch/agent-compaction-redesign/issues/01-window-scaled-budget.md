# 01: Window-scaled context budget

**Status:** resolved

**What to build:** Replace the fixed `CompactionSettings` (`reserveTokens: 16_384`, `keepRecentTokens: 20_000`) with a pure function of the model's `contextWindow` that returns `{ pruneAt, compactAt, keepRecent, summaryMaxTokens }`, and switch `maybeCompact` / `generateSummary` to it. Behaviour stays "compaction only" until 02 lands; `pruneAt` is computed but unused.

- [x] Defaults: `pruneAt = min(50% window, 100k)`, `compactAt = window − min(16k, 15% window)`, `keepRecent = min(25% window, 40k)`, `summaryMaxTokens = min(8k, 10% window)` (also capped by `model.maxTokens`)
- [x] Window ≤ 0 disables pruning and compaction
- [x] `shouldCompact` / `findCutPoint` callers use the budget
- [x] Tests: table over 32k, 128k, 200k, 1M and 0 windows

## Comments

- `contextBudget(contextWindow)` in `compaction.ts` replaces `CompactionSettings`; `summaryMaxTokens` is further capped by `model.maxTokens` in `generateSummary`.
