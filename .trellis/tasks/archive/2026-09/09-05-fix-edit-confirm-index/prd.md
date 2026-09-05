# PRD: Fix agent message edit confirm button index mismatch

## Background

Litera 的内嵌 agent runtime 支持在聊天面板中编辑已发送的用户消息：点击消息旁的铅笔进入编辑，修改后点确认（✓）按钮或按 Enter 提交。UI 通过 `editPrompt(messageIndex, ...)` 把**UI 气泡索引**传给 `useAgentBridge`，再传给 `embeddedAgentRuntime.prompt(..., editIndex)`。

用户报告：确认按钮"点击没有反应"。实际复现、诊断后确认这不是按钮本身的问题，而是一个索引失配 bug。

## Root Cause

`src/agent/runtime/embedded-runtime.ts` 的 `prompt()` 编辑分支（`editIndex !== undefined` 时）用**原始会话条目**解释索引：

```ts
const visible = branch.filter((entry) => entry.type === "message"
  && (["user","assistant"]).includes(entry.message?.role));
const target = visible[editIndex];
```

而 UI 侧索引来自 `visibleMessages()`（`src/agent/sessions/pi-session.ts`），语义不同：

- `toolResult` 消息两条路径都会隐藏（恰好一致）；
- 但 **连续的 assistant 条目（一次工具调用回合会产生 assistant(toolCall) → toolResult → assistant(text) 两条 assistant 条目）在 UI 中被合并成一个气泡**，runtime 的 filter 不合并。

只要历史中出现过一次工具调用（对读书助手几乎必然），之后的索引全部偏移。后果：

1. 偏移后索引落在 assistant 条目上 → 抛 `"Edited message is not a visible user message"` → 被 `classifyPromptError` 归类为 unknown，UI 显示误导性的「模型请求失败，请检查配置后重试」；用户感知即"点了没反应/报无关错误"。
2. 偏移后索引落在更早的 user 条目上 → **静默回滚到错误的历史位置**，编辑内容发到错误的分支点，数据正确性受损。

## Requirements

1. runtime 编辑分支的 `editIndex` 必须与 `visibleMessages()` 产出的 UI 消息索引语义一致：对同一会话状态，UI 显示的第 N 条消息必须精确对应 runtime 解析出的第 N 条可见消息。
2. 修复后必须保证：
   - 编辑工具调用回合之前的用户消息，回滚点正确（该消息之后的所有内容被丢弃，含其后的工具回合）；
   - 编辑普通回合的用户消息行为与现状（已正确）一致；
   - `session_rewound` 事件携带的 `messages` 与 UI 编辑前的消息列表一致（编辑目标消息及之前的内容）。
3. 编辑非法目标（索引越界或落在 assistant 气泡上）时仍应报错，但错误应可区分，不得被掩盖为「模型请求失败」。
4. 不改变持久化格式（session entries 结构不变）；只修索引解析逻辑。

## Acceptance Criteria

- [ ] 回归测试：在包含一次工具调用回合（assistant toolCall → toolResult → assistant text）的多回合会话中，编辑任一 user 消息（含工具回合之前的），`session.leafId` 回滚到正确的 `parentId`，`session_rewound.messages` 正确。
- [ ] 回归测试：编辑后新 prompt 正常完成（`prompt_end` 事件），新分支从正确位置生长。
- [ ] 现有全部测试（56 文件 / 627 用例）保持通过。
- [ ] `ChatPanel.edit-confirm.test.tsx`（UI 按钮链路）保持通过。

## Out of Scope

- 编辑消息的 UI 交互改造（按钮样式、快捷键等）。
- `classifyPromptError` 的错误分类体系重构（仅在必要时让编辑目标错误短路，不经过模型错误分类）。
- 多分支可视化管理。

## Notes

- 诊断过程中已留下两个测试文件（未提交）：
  - `src/components/chat/ChatPanel.edit-confirm.test.tsx`：UI 确认按钮 → `editPrompt` 链路，已通过，应保留入库。
  - `src/agent/runtime/embedded-runtime.edit.test.ts`：runtime 编辑流测试，当前断言了**修复前**的行为（编辑 index 0 的简单场景），修复时需更新为覆盖工具回合场景。
