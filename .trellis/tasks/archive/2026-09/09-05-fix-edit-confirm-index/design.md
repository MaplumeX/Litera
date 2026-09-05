# Design: Fix agent message edit confirm button index mismatch

## 边界与契约

**改动范围**（最小化）：

1. `src/agent/sessions/pi-session.ts`：新增导出函数 `visibleMessageEntries(session): PiSessionEntry[]` —— 按 `visibleMessages()` 完全相同的可见性语义返回消息条目（每个 UI 气泡 ↔ 一个锚点条目），供 runtime 与 `visibleMessages` 共用同一种遍历逻辑。
2. `src/agent/runtime/embedded-runtime.ts`：`prompt()` 编辑分支改用 `visibleMessageEntries()` 解析 `editIndex`；校验失败的错误信息保持原样抛出（在进入 `classifyPromptError` 之前就是本地校验错误，无需走网络错误分类——用独立 error 类型/前缀短路）。

**不改动**：

- session 持久化格式、`SessionPort`、Rust 侧。
- `visibleMessages()` 的现有行为（UI 已依赖）。
- `use-agent-bridge` / `ChatPanel`（UI 语义本来就是对的）。

## 核心设计

### 为什么不能直接在 runtime 里修 filter

`visibleMessages()` 的合并规则较复杂：toolResult 归并到 owner 气泡、连续 assistant 合并、compaction/branch_summary 截断分支等。在 runtime 里复制一份规则必然再次漂移。正确做法是让"可见消息锚点"成为单一事实来源：

```ts
// pi-session.ts
export function visibleMessageEntries(session: DecodedPiSession): PiSessionEntry[] {
  // 遍历 activeBranch(session)，跳过非 message 条目；
  // user 条目 → 产出锚点；
  // assistant 条目 → 连续 assistant 序列只产出第一个作为锚点（与 visibleMessages 合并行为对齐）；
  // toolResult 条目 → 跳过。
  // 返回的数组与 visibleMessages(session) 的输出一一对应（同长度、同顺序）。
}
```

`visibleMessages()` 可选择重构为基于同一遍历（推荐：内部抽共享遍历，两个导出函数都消费它），确保两者永远同步——**这是防止回归的关键**。若重构风险大，可先只新增 `visibleMessageEntries` 并用测试钉住「两函数输出长度/顺序一致」这一不变量。

### runtime 编辑分支改动

```ts
if (editIndex !== undefined) {
  const visible = visibleMessageEntries(session);   // 与 UI 索引同语义
  const target = visible[editIndex];
  if (!target || target.message.role !== "user") throw new Error("Edited message is not a visible user message");
  session.leafId = target.parentId;
  ...
}
```

注意：合并后的 assistant 气泡锚点是序列中**第一个** assistant 条目；编辑目标必须是 user 锚点。回滚点 `target.parentId` 语义不变（被编辑消息之前那条的 id）。

### 错误提示修复（小项）

`"Edited message is not a visible user message"` 目前经 `classifyPromptError` 变成「模型请求失败」。方案：`classifyPromptError` 前先识别本地校验错误直接透传原文（该文件已承诺"preset strings"，本地错误不属于网络分类范畴）。最小实现：runtime 的 catch 中对已知的本地校验错误消息直接使用原文。

## 数据流（修复后）

```
ChatPanel(编辑→✓) → editPrompt(uiIndex) → runtime.prompt(..., editIndex=uiIndex)
  → visibleMessageEntries(session)[uiIndex]  ← 与 visibleMessages() 同语义（单一事实来源）
  → 校验 user 锚点 → session.leafId = target.parentId → emit session_rewound
  → 新 prompt 从回滚点追加
```

## 兼容性

- 无持久化/协议变更；旧会话数据不受影响。
- 索引语义变化的唯一调用方是编辑流本身（prompt 的 editIndex 仅来自 editPrompt），无其他消费者。

## 测试策略

1. **不变量测试**（pi-session）：对包含工具回合、连续 assistant、多条 user 的会话，`visibleMessageEntries().length === visibleMessages().length` 且每个锚点 message 与对应 UI 消息 role 一致。
2. **runtime 回归**（embedded-runtime.edit.test.ts 重写）：
   - 工具回合后编辑第二问（UI index 2）→ 回滚正确 + prompt_end；
   - 编辑第一问（index 0）→ 回滚到分支根；
   - 编辑落在 assistant 气泡上 → 抛原始错误（非「模型请求失败」）。
3. 保留现有 ChatPanel UI 链路测试。

## 回滚

单 commit 修复；revert 该 commit 即完整回滚。测试文件随 commit 一起 revert。
