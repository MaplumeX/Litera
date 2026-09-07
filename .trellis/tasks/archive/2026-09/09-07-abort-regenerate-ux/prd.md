# Replace abort input backfill with regenerate affordance

## Goal

对齐业界通行做法：abort（停止生成）后不再把已发送的文本回填输入框，改为在消息流中提供明确的"重新生成"入口。将三种用户意图分离：**abort = 停止；regenerate = 重发；edit = 改写**。

## Background

当前实现（commit 9fde500 引入）：`ChatPanel.tsx` 在 abort 后监听 `state.status` 回到 `bookReady`，将 `lastSentRef` 中上次发送的文本回填输入框、恢复 pendingSelection，并高亮输入框 2 秒（`retryHighlight`）。

问题：
1. abort 时 runtime 已将用户消息 + `stopReason: "aborted"` 的 assistant 消息持久化进会话历史，回填导致同一句话在对话流和输入框中重复出现。
2. 回填预设了"用户一定想原样重发"，与停止的真实意图（答案跑偏 / 已够用想追问）不符。
3. abort 后输入新内容需先手动清空回填文本，增加摩擦。
4. `abortedRef` + `lastSentRef` + status effect 的组合在会话/书切换、错误路径上易误触发，脆弱。

业界标准（ChatGPT / Claude / Gemini，Cloudscape / Frontend Patterns 等设计规范一致）：
- Stop 后保留已流出的部分回答，输入框留空，可立即输入新内容。
- 重发由最后一条 assistant 消息下方的 "Regenerate" 按钮承担，同输入重新采样。
- 本项目已有消息分支系统（branch switching），regenerate 天然产生 sibling branch，符合 "keep attempts as switchable variants" 最佳实践。

## Requirements

### R1 移除回填逻辑
- 删除 `ChatPanel.tsx` 中 abort 后回填输入框的行为：`abortedRef`、`lastSentRef` 回填 effect、`retryHighlight` 状态及其 UI（`ChatInput.tsx` 的 ring 高亮）。
- abort 后输入框保持空白；已持久化的用户消息与 aborted assistant 消息保持在对话流中不变。

### R2 重新生成入口
- 在最后一条 assistant 消息（或对话流底部）提供"重新生成"按钮，非流式状态下可用。
- 点击后以**最后一条用户消息**为锚点重发原输入（含 selection / chapterHref 上下文），复用现有分支机制生成 sibling branch（不修改历史，走 `editPrompt` 或等价的分支重发路径）。
- 重新生成过程中按钮禁用/隐藏，流式结束后恢复。
- 已有的 BranchSwitcher 应能切换对比原回答与新回答（依赖现有分支能力，不额外开发）。

### R3 aborted 状态可感知
- `stopReason: "aborted"` 的 assistant 消息显示轻量"已停止"标识（如小标签），让停止状态可感知，替代回填高亮的提示作用。

### R4 兼容性
- 现有 edit（用户消息编辑）、branch switching、retry（网络错误重试）行为不受影响。
- 移除回填后，相关测试（如 `ChatPanel.edit-confirm.test.tsx` 及涉及 `retryHighlight` 的测试）同步更新。

## Out of Scope

- 自动重试 / 网络错误恢复流程的改动。
- regenerate 的变体选择 UI（如 temperature / prompt 调整）。
- aborted 消息的部分内容编辑。

## Acceptance Criteria

- [ ] abort 后输入框为空，无回填、无高亮；对话流保留用户消息与 aborted assistant 消息。
- [ ] 非流式状态下，最后一条 assistant 消息处有"重新生成"按钮；点击后以最后一条用户消息为锚重发，生成新 sibling branch，BranchSwitcher 可切换对比。
- [ ] aborted assistant 消息显示"已停止"标识。
- [ ] 流式过程中 regenerate 按钮不可触发。
- [ ] 既有 edit / branch switch / retry 测试全部通过；被移除行为的测试已删除或改写。
- [ ] `npm run lint` / `npm test`（或项目等效命令）通过。

## Notes

- 复杂度评估：中等。涉及 ChatPanel 状态清理、regenerate 交互（含 runtime 分支重发路径复用）、aborted 标识三处改动，建议补 `design.md` + `implement.md`。
