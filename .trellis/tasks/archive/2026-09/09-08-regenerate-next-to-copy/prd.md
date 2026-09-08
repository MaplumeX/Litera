# Move regenerate button next to copy button

## 背景

上一个任务（09-07-abort-regenerate-ux）把「重新生成」按钮放在了对话流底部居中位置。但复制按钮位于助手消息最后一个文本块下方的按钮行内，两个操作按钮分离，不符合用户预期。

## 需求

- 「重新生成」按钮移到最后一条 assistant 消息最后一个文本块下方的按钮行中，与 `CopyButton` 并排显示。
- 显示条件维持现状语义：非流式、bookReady、存在至少一条 user 消息。
- 流式过程中按钮不可触发（不渲染或禁用，与现状一致即可）。
- i18n 文案沿用现有 `chat.regenerate`，不新增 key。

## 约束

- `handleRegenerate` 逻辑（findLast user index → `editPrompt` 原文重发）不变。
- 仅最后一条 assistant 消息显示该按钮；中间的 assistant 消息不显示。
- 若最后一条可见消息是 user（assistant 缺失/出错），保持按钮可用（等价于重发最后问题）——可放在 user 消息下方或消息流底部，实现时选择最简方案，但需与 copy 按钮视觉一致。

## 验收标准

- [ ] 非流式状态下，最后一条 assistant 消息最后一个文本块下方按钮行内同时可见「复制」与「重新生成」按钮。
- [ ] 点击「重新生成」行为与现状一致：生成 sibling branch，BranchSwitcher 可切换。
- [ ] 流式过程中按钮不出现/不可触发。
- [ ] 中间 assistant 消息不显示「重新生成」。
- [ ] `ChatPanel.regenerate.test.tsx` 更新并通过；全量测试与 tsc 通过。

## 复杂度

轻量任务：纯 UI 位置调整 + 测试适配，PRD-only。
