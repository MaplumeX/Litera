# 06: Compaction summary card

**Status:** resolved
**Blocked by:** 04

**What to build:** One transcript element for compaction instead of chip + divider.

- [x] Delete `CompactionChip`; reducer `compaction` state drives a pending divider (spinner, "正在整理上下文…") at the end of the transcript, also when no prompt is active
- [x] On completion the pending divider is replaced by the durable `CompactionNotice` from `visibleMessages`
- [x] Expanded summary renders with the assistant Markdown renderer (Citations included), not `<pre>`
- [x] Failed state: short muted line, dismissed on next prompt
- [x] Locale strings in `en.ts` and `zh-CN.ts`
- [x] Tests: pending, done, failed, expanded Markdown

## Comments

- `CompactionChip` deleted; `CompactionStatus` (pending divider / failure line) and `CompactionNotice` live in `CompactionNotice.tsx`. The summary renders with `MarkdownText` exported from `AssistantMessage.tsx`. The failure line clears on `prompt_queued`.
- Follow-up: a compaction that completes during a prompt (pre-prompt or overflow recovery) inserts its notice at its persisted position right away instead of waiting for `prompt_end`, keeping the optimistic question and streamed tail after it. Overflow recovery shows "上下文超出限制，正在压缩后重新回答…" (`compaction_started.reason: "overflow"` → `status: "recovering"`) while the failed attempt is still visible, so its removal on retry is explained. Pruning stays invisible by design.
