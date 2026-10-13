# Spec: Redesign Session context compaction

Status: resolved

## Problem Statement

Compaction (`src/agent/compaction/compaction.ts`, `EmbeddedAgentRuntime.maybeCompact`) is a near-verbatim port of pi's coding-agent compaction. In a reading assistant it feels bad:

1. **It blocks the reader.** `maybeCompact` runs synchronously before the prompt (the answer only starts after a summary request of up to ~13k output tokens) and again after the turn, *before* `prompt_end` — so the input stays locked after the answer has finished rendering.
2. **It is not recoverable.** A request that overflows the context window is surfaced as an error instead of being compacted and retried. A failed compaction is silent (`compaction_failed` just clears the chip), so the next request overflows too. The summary request ignores the stop button (`signal` is `undefined`).
3. **The summary template is wrong for the domain.** Goal / Progress / Done / Blocked / Next Steps describes a coding task, not a conversation about a Book. What a reading Session must keep — which chapters were discussed, the reader's interpretations and open questions, verified Citations — has no slot.
4. **Fixed thresholds.** `reserveTokens: 16_384` and `keepRecentTokens: 20_000` ignore the model's window: a 32k model barely works, a 1M model pays for hundreds of thousands of stale tokens every turn before anything happens.
5. **The expensive part is re-fetchable.** Most context is `read_chapter` output — Book text the assistant can read again at any time. Paying an LLM call to "remember" it is the wrong tool.
6. **UI duplication.** A transient `CompactionChip` and the durable `CompactionNotice` say the same thing; the summary renders as raw Markdown in a monospace `<pre>`.

## Solution

Two tiers, cheapest first, both off the reader's critical path:

- **Pruning** (new): replace older Book-reading tool results in the model-facing projection with short placeholders that tell the model how to re-read. No LLM call, instant, persisted as a new `context_prune` Session entry. Handles the common case on its own.
- **Compaction** (reworked): when pruning is not enough, summarize older turns with a reading-oriented template. Runs after the answer is delivered, without locking the input; abortable; retried on overflow.

Thresholds scale with the model's context window. The transcript stays complete; the Compaction notice becomes a rendered summary card that also shows the in-progress state, replacing the chip.

Out of scope (decided): manual compaction trigger and a context-usage indicator.

## User Stories

1. As a reader, I want my answer to start streaming right after I send a prompt, so that long Sessions do not feel slower than short ones.
2. As a reader, I want the input to unlock as soon as the answer finishes, so that I am never waiting on housekeeping I did not ask for.
3. As a reader in a long Session, I want the assistant to still remember which chapters we discussed, what I thought about them and what I asked, so that the conversation stays coherent after compaction.
4. As a reader, I want a request that ran out of context to recover by itself, so that I do not see an error for something the app can fix.
5. As a reader, I want the stop button to stop compaction too, so that I keep control.
6. As a reader using a small-context model, I want long Sessions to keep working, so that model choice does not break the assistant.
7. As a reader, I want to read the compaction summary as formatted text, so that I can check what the assistant kept.

## Implementation Decisions

- **Budget module.** Replace `CompactionSettings`/`DEFAULT_COMPACTION_SETTINGS` with a function of `contextWindow` returning `{ pruneAt, compactAt, keepRecent, summaryMaxTokens }`. Starting defaults (tunable, covered by tests): `pruneAt = min(50% window, 100k)`, `compactAt = window − min(16k, 15% window)`, `keepRecent = min(25% window, 40k)`, `summaryMaxTokens = min(8k, 10% window)`. Windows ≤ 0 disable both tiers, as today.
- **`context_prune` entry.** Fields: `throughEntryId` — every `toolResult` of `read_chapter` / `search_in_book` / `get_toc` on the active branch at or before that entry is cleared. Cumulative: only the branch's latest prune entry matters, mirroring how only the latest `compaction` applies. Never anchors a visible message (no transcript marker, `visibleMessageAnchors` skips it). The Rust store already accepts arbitrary entry types; no Rust change. Older app versions ignore the entry and send the full results — harmless.
- **Projection.** `contextBranch` applies the latest compaction, then the latest prune; pruned tool results keep `toolCallId`/`toolName` (providers require the pairing) but their content becomes e.g. `[read_chapter result (chapter 3, part 1/4) cleared to save context. Call read_chapter again if you need the text.]`. `activeBranch` and everything UI-facing (source summary, Citations, tool cards) are untouched.
- **Prune policy.** When context > `pruneAt`, prune everything up to the start of the latest user turns that fit in `keepRecent`. Pruning in one batch (not a sliding window) keeps the provider prompt cache prefix stable between prunes. If the estimate after pruning is still > `compactAt`, compact.
- **Summary content.** New reading-oriented template (sections such as: Book & scope discussed, Reader's questions and positions, Key points and conclusions, Citations worth keeping (verbatim, with chapterIndex), Open questions). Serialization drops thinking blocks, renders book tool calls compactly (`read_chapter(ch 3, part 1)`), omits `read_chapter` result text, truncates search results, and skips `bookSnapshot` (re-inserted automatically when absent from `contextBranch`). Summary written in the Session's language.
- **Cut points.** A cut lands on a user message *together with* its preceding `readingContext` entry, never between them.
- **Scheduling.** Post-turn maintenance (prune, then maybe compact) starts after `prompt_end` is emitted and the input is unlocked. It holds its own abort controller; `abort()`, book switch, session switch and config invalidation abort it. A new prompt that arrives while it runs awaits it (the in-progress card is visible). Pre-prompt maintenance stays only as a cheap check: prune synchronously; compact only if the context would not fit (e.g. after switching to a smaller model).
- **Overflow recovery.** When a request fails with `isContextOverflow`, prune + compact (forced, ignoring thresholds) and retry the request once. If compaction fails or the retry overflows again, surface the existing prompt error.
- **Failure.** A failed compaction emits `compaction_failed` and the card shows a short non-blocking failure state; no automatic retry until the next turn.
- **UI.** Delete `CompactionChip`. `CompactionNotice` becomes a summary card: collapsed divider by default, expanded body rendered with the assistant Markdown renderer. While compacting, a pending divider with a spinner sits at the end of the transcript and turns into the card on completion.

## Testing Decisions

- Budget: table tests over window sizes (32k, 128k, 200k, 1M, 0).
- Prune projection and policy: pure tests on `contextBranch` with built entry lists (tool-call pairing preserved, latest prune wins, prune + compaction combined, branches).
- Summary serialization and cut points: extend `compaction.test.ts`.
- Scheduling, abort and overflow retry: extend `embedded-runtime.test.ts` with a fake stream function (overflow → compact → retry; abort during compaction; prompt during background compaction).
- UI: `ChatPanel` / `CompactionNotice` component tests for pending, done, failed states.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Window-scaled context budget | resolved | — |
| 02 | Pruning of Book-reading tool results | resolved | 01 |
| 03 | Reading-oriented summary and cut points | resolved | — |
| 04 | Non-blocking, abortable post-turn maintenance | resolved | 02 |
| 05 | Overflow recovery and failure state | resolved | 04 |
| 06 | Compaction summary card | resolved | 04 |
