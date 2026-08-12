# 聊天面板消息交互增强 — 技术设计

## 涉及文件

- `src/components/ChatPanel.tsx` — 主要改动点
- 无需新增文件或修改 hook/类型/reducer

## 当前状态分析

`ChatPanel` 的 `handleSend` 流程：
1. 读取 `input` + `pendingSelection`
2. 清空 `input` + `pendingSelection`
3. `setSubmitting(true)`
4. 调用 `prompt(text, { selection, chapterIndex }, message)`
5. 出错时 `setSubmitting(false)`

`handleAbort` 调用 `abort()`。中止后 reducer 收到 `prompt_aborted`，状态回到 `bookReady`，但 `input` 已被清空，用户无法重发。

## 设计方案

### 12 停止后重试

**机制**：在 `handleSend` 时记录"最后发送的 payload"（text + selection + chapterIndex）。当检测到 `prompt_aborted` 事件（通过 `state.promptId` 从有变无 + 之前处于 submitting）时，恢复输入框为原 text，并重新挂载 `pendingSelection`。

**实现细节**：
- 新增 `lastSentRef` 保存最近一次发送的 `{ text, selection, chapterIndex }`。
- 新增 `abortedRef` 标记是否因中止而恢复。
- 在 useEffect 中监听 `state.status`：当从 `prompting` 变为 `bookReady` 且 `abortedRef` 为 true 时，恢复 `input` + `pendingSelection`，清标记。
- 为避免"正常 prompt_end 也触发恢复"，改用显式标记：`handleAbort` 调用后设 `abortedRef.current = true`。

**视觉提示**：恢复后输入框加 `ring-2 ring-primary` 高亮，2 秒后自动消失（或发送后消失）。

### 15 消息复制

**机制**：每条 assistant 消息渲染区添加复制按钮。使用 `navigator.clipboard.writeText(message.content)`。

**UI**：复制按钮用 `Copy` 图标（lucide-react），浮在消息右上角，hover 显示。点击后图标短暂变为 `Check`（1.5 秒）。

### 15 消息编辑

**机制**：每条 user 消息渲染区添加编辑按钮。点击后：
1. 将 `message.content` 填入 `input`
2. 若原消息有 `selection`，恢复 `pendingSelection`
3. `inputRef.current?.focus()`
4. 用户修改后按 Enter 发送 → 走正常 `handleSend` → 新消息追加到末尾

**不引入编辑态字段**：编辑只是"填入输入框"，不改变原消息渲染。原消息保留在历史中，新消息由 `prompt()` 的 `user_message` dispatch 追加。

**UI**：编辑按钮用 `Pencil` 图标，浮在 user 消息右上角 hover 显示。

## 数据流

```
[中止] handleAbort → abortRef=true → prompt_aborted 事件 → status=bookReady
  → useEffect 检测 → 恢复 input + pendingSelection → ring 高亮

[复制] 点击 Copy → navigator.clipboard.writeText → 图标切换 1.5s

[编辑] 点击 Pencil → setInput(message.content) + setPendingSelection → focus
  → 用户 Enter → handleSend → prompt() → 新消息追加
```

## 风险与权衡

- **中止 vs 正常结束的区分**：方案用 `abortedRef` 显式标记，不依赖状态推断，可靠。
- **编辑后原消息仍可见**：这是有意设计（保留历史），符合多数聊天应用习惯。若用户期望"替换"，需引入分支式会话，超出本任务范围。
- **复制按钮空间**：移动端 hover 不可用，但当前是桌面 Tauri 应用，hover 可接受。