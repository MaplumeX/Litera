# Design: 压缩指示

## 架构概述

事件流：`maybeCompact`（runtime）→ `emit(AgentEvent)` → `useAgentBridge` 订阅 → `agentReducer` → `ChatPanel` 渲染 chip。

需要在三个层做改动：types、runtime、reducer+UI。

## 数据流与契约

### 1. AgentEvent 新增事件类型（`src/types/agent.ts`）

```ts
| ({ type: "compaction_started" } & PromptCorrelation)
| ({ type: "compaction_completed" } & PromptCorrelation)
```

用 `PromptCorrelation`（含 bookId/sessionId/promptId）保持与 prompt 生命周期一致。不需要单独 RequestCorrelation。

### 2. runtime 发送事件（`src/agent/runtime/embedded-runtime.ts`）

`maybeCompact` 改为分两阶段 emit：

- 进入 `prepareCompaction` 成功后、调用 `generateSummary` 前：`emit({ type: "compaction_started", ...base })`
- `generateSummary` 成功并写入 compaction entry 后：`emit({ type: "compaction_completed", ...base })`
- 失败路径（catch 分支）：emit `compaction_failed`，让 reducer 清除进行中态

`base` = `{ bookId, sessionId: session.header.id, promptId: this.promptId }`。注意 `maybeCompact` 当前没有 promptId 参数，但 `this.promptId` 在调用时一定已设置（prompt 方法开头赋值），可直接读取。

### 3. AgentState + reducer（`src/lib/agent-reducer.ts`）

State 新增字段：
```ts
compaction: { status: "compacting" | "compacted" } | null;
```

reducer 处理：
- `compaction_started` → `compaction = { status: "compacting" }`
- `compaction_completed` → `compaction = { status: "compacted" }`
- `compaction_failed` → `compaction = null`
- `prompt_end` / `prompt_aborted` → 保持 compaction 状态不变（compacted 标记应保留）
- `session_switched` / `session_rewound` → `compaction = null`（切换会话时清除）

### 4. ChatPanel 渲染 chip（`src/components/chat/ChatPanel.tsx`）

在消息列表底部（`messagesEndRef` 前）插入：

```tsx
{state.compaction && (
  <CompactionChip status={state.compaction.status} />
)}
```

新建 `src/components/chat/CompactionChip.tsx`：
- compacting：居中、小字号、muted 色、spinner + "正在压缩上下文…"
- compacted：居中、小字号、muted 色、无 spinner、"上下文已压缩"
- 不使用 MessageBubble，视觉轻于普通消息

### 5. i18n 文案（`src/locales/zh-CN.ts`、`src/locales/en.ts`）

```
"chat.compacting": "正在压缩上下文…" / "Compacting context…"
"chat.compacted": "上下文已压缩" / "Context compacted"
```

## 关键决策与权衡

- **chip 位置**：放消息流底部而非按 compaction entry 插入。理由：compaction entry 是 session 内部状态，visibleMessages 不暴露它；chip 只需反映"刚刚发生了压缩"，作为瞬时+保留标记。切换会话时清除，回到会话时不再显示（历史压缩标记不回显）。
- **不回显历史压缩**：切回会话时从 session 恢复消息，但不重建 compaction chip。避免需要扫描 entries 判断"最后是否有 compaction"，保持简单。用户只在压缩发生当下看到指示。
- **失败态不显示**：maybeCompact 吞掉错误，但需 emit `compaction_failed` 让 reducer 清除进行中 chip，避免 spinner 永转。

## 兼容性

- AgentEvent 是联合类型扩展，不影响现有事件处理
- AgentState 新增可选字段，reducer 现有分支不变
- 无数据迁移：compaction entry 格式不变