# 聊天面板消息交互增强 — 执行计划

## Checklist

### 1. 中止后重试

- [ ] 在 `ChatPanel` 新增 `lastSentRef`（保存 `{ text, selection, chapterIndex }`）和 `abortedRef`（boolean）。
- [ ] `handleSend` 成功调用 `prompt()` 前记录 `lastSentRef.current = { text, selection, chapterIndex }`。
- [ ] `handleAbort` 设 `abortedRef.current = true`。
- [ ] 新增 useEffect 监听 `state.status`：当 `abortedRef.current && state.status === "bookReady"` 时，恢复 `input` 为 `lastSentRef.current.text`，恢复 `pendingSelection`，设 `abortedRef.current = false`，触发 ring 高亮 2s。
- [ ] 新增 `retryHighlight` state，恢复时设 true，setTimeout 2s 后 false；输入框 className 条件加 `ring-2 ring-primary`。

### 2. AI 回复复制

- [ ] 导入 `Copy`、`Check` 图标（lucide-react）。
- [ ] 新增 `CopiedButton` 子组件：管理 `copied` state，点击 `navigator.clipboard.writeText`，图标切换 1.5s。
- [ ] 在 assistant 消息渲染区（`message.content` 存在时）右上角放置 `CopiedButton`，传入 `message.content`。

### 3. 用户消息编辑

- [ ] 导入 `Pencil` 图标。
- [ ] 在 user 消息渲染区添加编辑按钮，点击调用 `handleEdit(message)`。
- [ ] `handleEdit`：`setInput(message.content)`，若 `message.selection` 则 `setPendingSelection({ text: message.selection, chapterIndex: message.chapterIndex ?? currentChapterIndex })`，`inputRef.current?.focus()`。

### 4. 验证

- [ ] `npm test` 通过。
- [ ] `npm run build`（tsc + vite build）通过。
- [ ] 手动验证：中止后输入框恢复 + 可重发；复制按钮工作；编辑按钮填入输入框 + 发送产生新消息。

## Validation Commands

```bash
npm test
npm run build
```

## Review Gates

- 中止恢复不应误触发于正常 `prompt_end`（靠 `abortedRef` 显式标记保证）。
- 编辑重发后原消息应仍可见（不删除历史）。
- 复制按钮不应在 toolCall-only 的 assistant 消息（无 content）上显示。