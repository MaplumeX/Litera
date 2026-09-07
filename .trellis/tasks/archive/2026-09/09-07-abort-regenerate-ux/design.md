# Design — Replace abort input backfill with regenerate affordance

## 总体思路

三个独立但相关的改动：

1. **R1 移除回填**：纯删除（`ChatPanel.tsx` 的 ref/effect/state + `ChatInput.tsx` 的高亮 prop）。
2. **R2 常驻 regenerate 按钮**：UI 层新增交互，复用 `editPrompt` 分支重发机制；核心前置工作是**补齐用户消息上下文的持久化与投影**（当前 `selection`/`chapterHref` 在持久化时被丢弃）。
3. **R3 aborted 标识**：`AgentMessage` 增加 `stopReason` 投影 + assistant 消息角落小标签。

## D1 数据契约变更（pi-session 投影层）

### 现状
- `embedded-runtime.ts` prompt 流程中 `const user:PiMessage={role:"user",content:text}` —— 只有文本。
- `visibleMessages()`（`src/agent/sessions/pi-session.ts`）投影用户消息时 `output.push({ role: "user", content: contentText(message.content) })` —— 丢失 selection/chapterHref。
- **后果**：regenerate 无法从历史消息还原完整上下文；且 branch switch / session reload 后 UI 上用户消息的引用选区也会丢（现状已如此，本任务顺带修复）。

### 变更
1. **持久化**（`embedded-runtime.ts`）：用户消息 entry 的 payload 增加可选字段：
   ```ts
   { message: user, selection?: string, chapterHref?: string }
   ```
   PiMessage 侧不改动（LLM 上下文不受影响）；上下文字段放在 **entry 层**（与 `newEntry("message", parent, { message })` 的 payload 结构同级），避免污染 pi 消息协议。
2. **投影**（`pi-session.ts`）：
   - `visibleMessages()`：用户消息投影为 `{ role, content, selection?, chapterHref?, anchorId? }`（从 entry payload 透传）。
   - **新增 `stopReason?: "aborted" | "error" | "stop"`** 到 assistant 消息投影（从 `message.stopReason` 读取，仅在非 "stop" 时携带，减小 payload）。
   - `AgentMessage`（`src/types/agent.ts`）UI 类型扩展：`stopReason?: "aborted" | "error"`（UI 只关心这两种非正常态）。
3. **兼容性**：旧 session 文件没有这些字段 → 投影时 undefined，自然降级。新字段是纯附加，Rust 侧 `append` 对 entry payload 透传（`pi_sessions.rs` 的 payload 是 serde Value/透传结构，需确认；若 Rust 侧有强类型校验则同步加 optional 字段）。

### anchorId（regenerate 的定位基础）
- regenerate 需要"最后一条用户消息的 index"，当前用 `visibleMessages` 的数组下标；`editPrompt` 的 `editIndex` 也是同一坐标系（`visibleMessageEntries(session)[editIndex]`）。**沿用现有下标语义，不新增 anchor 定位**，避免坐标系分裂。

## D2 Regenerate 交互（ChatPanel）

### 触发条件（按钮显示）
- `state.messages` 最后一条消息是 assistant（或最后一条是 user 但非 streaming——错误分支遗留，见下方边界）
- `!isStreaming && bookReady`
- 按钮位置：**对话流底部、最后一条 assistant 消息下方**（`messagesEndRef` 前），样式与 `CopyButton` 一致的小型 ghost 图标按钮 + 文案（`RefreshCw` 图标）。

### 点击行为
```ts
handleRegenerate = async () => {
  // 1. 找最后一条 user 消息 index
  const lastIndex = findLastIndex(state.messages, m => m.role === "user");
  if (lastIndex < 0) return;
  const original = state.messages[lastIndex];
  // 2. 复用 editPrompt：原文重发 → runtime rewind 到该消息父节点 → sibling branch
  await editPrompt(lastIndex, original.content,
    { selection: original.selection, chapterHref: original.chapterHref },
    { role: "user", content: original.content, ... });
};
```
- **不需要修改历史**：`editPrompt(editIndex, 原文)` 走的就是 `session.leafId = target.parentId` → 重发 → 新 sibling branch。原文重发 = regenerate。
- 重发过程中 `isStreaming` 为 true → 按钮自然隐藏（条件已含 `!isStreaming`）。
- **BranchSwitcher 对比**：新 branch 生成后，锚点用户消息的 `BranchSwitcher` 会出现 2+ 选项（现有能力），无需改动。

### 边界情况
1. **最后一条是 user（assistant 缺失/错误）**：也显示 regenerate（等价于重发最后问题）。判断条件简化为"存在至少一条 user 消息且非 streaming"。
2. **只有 assistant 无 user**（不可能：prompt 必带 user；title 生成是 fire-and-forget 不入流）→ 按钮不显示。
3. **会话为空**：不显示。
4. **regenerate 与 edit 冲突**：`isStreaming` 期间 edit 已禁用；regenerate 触发后 `editingIndex` 强制清空（同 `handleSend` 的行为）。
5. **模型中途切换**：regenerate 用当前配置的模型（`ensureAgent` 每次按 config 重建 agent），符合"重新采样"预期。

## D3 移除回填（ChatPanel / ChatInput）

删除清单：
- `ChatPanel.tsx`：`lastSentRef`、`abortedRef`、回填 effect（`state.status` 依赖那个）、`retryHighlight` state 及 timeout；`handleSend`/`handleSaveEdit` 中对 `lastSentRef.current = ...` 的赋值。
- `ChatInput.tsx`：`retryHighlight` prop、textarea 的 `ring-2 ring-primary` 条件类名。
- `ChatInput.test.tsx`：`retryHighlight: false` mock 行。
- 检查 `App.reader-mode.test.tsx` 是否依赖回填行为（"preserves the input draft" 是阅读器模式切回，与 abort 无关，预期保留）。

## D4 Aborted 标识（AssistantMessage）

- `AssistantMessage` 组件：`message.stopReason === "aborted"` 时在消息气泡角落显示小标签 `<span class="text-[10px] text-muted-foreground/70">已停止</span>`（i18n key `chat.stopped`）。
- `stopReason === "error"` 已有错误展示路径（`errorMessage`），不重复。
- 流式中的消息不显示（aborted 只在终态出现，天然满足）。

## D5 i18n

新增 key（`src/locales/en.ts` + `zh-CN.ts`）：
- `chat.regenerate`: "Regenerate" / "重新生成"
- `chat.stopped`: "Stopped" / "已停止"

## 数据流图

```
[Regenerate 点击]
  → ChatPanel.handleRegenerate
  → bridge.editPrompt(lastUserIndex, 原文, {selection, chapterHref}, msg)
  → runtime.prompt(text, ctx, promptId, requestId, editIndex)
      → session.leafId = target.parentId   (rewind, emit session_rewound)
      → 追加新 user entry (含 selection/chapterHref payload)
      → LLM 重新采样 → 新 sibling branch
      → prompt_end: messages + navigation → BranchSwitcher 可切换
```

## 权衡记录

- **entry 层存上下文 vs PiMessage 层**：选 entry 层。LLM 上下文协议（PiMessage）不动，投影层负责 UI 还原；避免 agent 重建时 `piContextMessages` 受未知字段影响。
- **下标定位 vs anchorId 定位**：选下标（现状 editPrompt 语义）。anchor 体系服务于 branch 切换，引入双重坐标系得不偿失。
- **regenerate 常驻 vs 仅 aborted 后**：用户已选 B（常驻），与 ChatGPT/Claude 一致。
