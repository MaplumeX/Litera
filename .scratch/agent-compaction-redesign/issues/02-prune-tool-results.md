# 02: Pruning of Book-reading tool results

**Status:** resolved
**Blocked by:** 01

**What to build:** A new `context_prune` Session entry and its projection, so older `read_chapter` / `search_in_book` / `get_toc` results stop costing context without an LLM call. Trigger it when context exceeds `pruneAt`.

- [x] Entry shape: `{ type: "context_prune", throughEntryId }`; only the branch's latest prune applies (cumulative)
- [x] `contextBranch` applies latest compaction, then latest prune; pruned `toolResult`s keep `toolCallId`/`toolName`/`isError` and get placeholder text naming the tool and its arguments (e.g. chapter and part) plus how to re-read
- [x] `activeBranch`, `visibleMessageAnchors`, `visibleMessages` ignore the entry (no transcript marker; source summary and tool cards unchanged)
- [x] Policy: prune through the entry before the oldest user turn kept within `keepRecent`; one batch per trigger so the prompt-cache prefix stays stable
- [x] After pruning, re-estimate; compact only if still above `compactAt`
- [x] `agent.state.messages` rebuilt from the projection, keeping the leading `system` message (same as compaction today)
- [x] Tests: projection (pairing preserved, latest wins, combined with compaction, branch switch), policy thresholds

## Comments

- Placeholder text: `[Result of read_chapter(chapterIndex=3, part=1) was cleared to save context. Call read_chapter again if you need it.]`. Pruned projection entries carry `pruned: true` so `preparePrune` skips them.
- `estimateBranchTokens` replaces the old timestamp debounce: a usage reported before the latest prune/compaction entry is ignored and the context is estimated instead.
