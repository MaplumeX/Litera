# PRD: ChatGPT 式消息分支切换

## Goal

用户在会话中编辑历史消息后产生新分支时，能在消息气泡处通过切换器（如 `< 2/3 >`）在不同分支之间来回切换，并可在切换后的分支上继续对话。真正利用会话树结构，对齐 ChatGPT 网页端的体验。

## 背景与现状（代码证据）

- 会话以树结构存储：`PiSessionEntry.parentId`（`src/agent/sessions/pi-session.ts`），`leafId` 指向活跃叶子
- `activeBranch()`（pi-session.ts:117）只走 `leafId → root` 单一路径
- 编辑消息（`embedded-runtime.ts` prompt 的 `editIndex` 路径）把 `session.leafId` 指到编辑点的 parent，新分支从那里长出；旧分支保留在树中但无法访问
- **Rust 侧 `load()`（`src-tauri/src/pi_sessions.rs:152`）把 `leaf_id` 硬编码为 `entries.last()`**——活跃分支指针不持久化，重载后永远回到最后追加的分支
- **Rust 侧 `append()`（pi_sessions.rs:241）乐观锁校验 `existing.last() != expected_leaf_id` 则拒绝**——无法在非末尾分支上续写
- UI 层（`ChatPanel.tsx` / `MessageBubble.tsx`）完全没有分支导航入口

## Requirements

### R1 数据层：分支结构计算（前端 lib）
- 给定 `DecodedPiSession`，计算每个可见用户消息锚点（`visibleMessageEntries`）处的兄弟分支集合：同一 `parentId` 下通往不同后代路径的分叉
- 每个分支提供预览文本（分支上第一条用户消息的文本，截断展示）
- 指示当前活跃分支在兄弟分支中的位置（第几个 / 共几个）

### R2 持久化：活跃分支指针（Rust + IPC）
- 持久化"当前活跃 leafId"，使切换分支后重开应用 / 重载会话仍停留在所选分支
- `append()` 乐观锁改为校验 `expectedLeafId` 存在于文件中（而非必须是最后一个 entry），允许在旧分支上续写
- 新增 IPC：切换活跃分支（校验目标 leafId 存在且从根可达）

### R3 运行时：分支切换
- `LiteraAgentRuntime` 暴露 `switchBranch(sessionId, targetLeafId)` 之类的方法，更新内存 session 的 `leafId` 并持久化
- 切换后发出事件，UI 消息列表整体替换为目标分支的 `visibleMessages`
- 切换后继续 prompt 时正确挂到新分支的叶子下
- 流式生成中（`promptId` 活跃）禁止切换

### R4 UI：消息分支切换器
- 在产生过分叉的用户消息气泡上渲染切换器（`< 2/3 >` 风格），左右切换分支，显示当前序号
- 切换后整条消息流立即切换到目标分支
- 无分叉的消息不显示切换器
- 需要处理与现有编辑确认流程（`ChatPanel.edit-confirm`）的交互

## Resolved Decisions

- **D1（原 Q1）**：MVP 不含 regenerate（重新生成助手消息产生分支），列为后续任务
- **D2（原 Q2）**：目标分支含中断残留消息时正常显示，不做特殊处理（`visibleMessages` 现有逻辑已正确投影）
- **D3**：切换回旧分支后**可以继续对话**（完整 ChatGPT 体验，用户选定方案 A）——Rust 持久化活跃 leafId 指针 + append 乐观锁放宽

## Acceptance Criteria

1. 编辑一条历史消息并发送后，原消息处出现切换器 `1/2`；切回 `1` 显示旧分支消息，切到 `2` 显示新分支
2. 在切换回的旧分支上继续发消息，新消息挂到旧分支叶子下，持久化后重开应用仍在该分支
3. 三个以上分支（多次编辑同一条消息）时切换器显示正确序号并可循环/边界导航
4. 流式生成中切换器不可用
5. 现有测试全部通过；新增数据层/运行时/UI 层测试

## Out of Scope

- Assistant 消息的 regenerate（重新生成）产生分支
- 分支树可视化（树状图查看全部历史分支）
- 分支删除/合并管理
