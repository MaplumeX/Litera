# Design: ChatGPT 式消息分支切换

## 架构总览

四层改动，自底向上：

```
Rust (pi_sessions.rs)          活跃分支指针持久化 + append 乐观锁放宽 + set_leaf IPC
  └─ SessionPort (TS)          新增 setLeaf 方法
      └─ pi-session.ts         branchNavigation() 纯函数：兄弟分支枚举
          └─ embedded-runtime  switchBranch() + prompt 挂载修正
              └─ agent-reducer / AgentEvent  branch_switched 事件
                  └─ ChatPanel / BranchSwitcher  UI 切换器
```

## 一、数据层：branchNavigation()（src/agent/sessions/pi-session.ts）

**核心算法**：对每个"用户消息锚点"计算分叉信息。

一个用户消息锚点 entry U（`visibleMessageEntries` 的元素）在分支树中代表一条边 `parent(U) → U`。当同一 `parentId` 下存在多个**消息子树分支**时产生分叉。

定义：对某个 `parentId`，收集所有以该 parent 为根的后代路径中，**第一条用户消息 entry**（沿每条路径深度优先遇到的第一个 role=user 的 message entry，跳过 custom_message / model_change 等非用户消息 entry）。这些"首用户消息"互为兄弟分支。数量 > 1 即为分叉点。

```ts
export interface BranchOption {
  anchorId: string;        // 该分支的首条用户消息 entry id
  preview: string;         // 首条用户消息文本（截断 ~40 chars）
}
export interface AnchorBranchInfo {
  options: BranchOption[]; // 有序：按首条用户消息的 timestamp 排序
  activeIndex: number;     // 当前活跃分支在 options 中的下标
}
export function branchNavigation(session: DecodedPiSession): Map<string, AnchorBranchInfo>;
// key = 分叉点各分支首条用户消息的 anchorId（即每个分支自己那条消息的 entry id）
```

- 分支排序：按 entry timestamp 升序（编辑产生的新分支在后，对齐 ChatGPT 序号习惯）
- `activeIndex`：遍历 `activeBranch(session)`，找到属于该分叉点的那条用户消息 entry，其在 options 中的下标
- 只在 `visibleMessageEntries` 锚点处理：非锚点不分叉（首条消息必是锚点）

**依据**：编辑流程（embedded-runtime.ts prompt editIndex 路径）将 `session.leafId` 指到 `target.parentId`，新用户消息从该点长出——所以分叉点必是"同一 parent 的多个用户消息子节点"。

## 二、Rust 持久化（src-tauri/src/pi_sessions.rs）

### 2.1 活跃分支指针

不改动 JSONL entry 格式（append-only 兼容），指针存到**旁文件**：`{session_id}.jsonl.leaf`，内容为目标 leafId 的一行文本。

- `load(book_id, session_id)`: 读取旁文件；存在且 leafId 在 entries 中 → 用它作为 `leaf_id`；否则回退 `entries.last()`（现有行为，兼容旧数据）
- `set_leaf(book_id, session_id, leaf_id)`: 校验 leafId 存在于 entries → 原子写旁文件
- `delete`: 一并删除旁文件
- `append`: 成功后**更新旁文件**为新 leaf（保持"最新分支"语义：续写总是推进活跃指针）

### 2.2 append 乐观锁放宽

现状：`existing.last() != expected_leaf_id` 则拒绝。改为：
- `expected_leaf_id` 为 `None` → 要求 `existing` 为空（现有语义，新会话）
- `Some(id)` → 校验 id 存在于现有 entries 的 id 集合中（放宽点：不再要求是最后一条）
- 仍返回 `entries.last()` 的 id 作为新 leaf

`validate_entries` 已保证 `parentId` 先于子 entry 出现且全局无环，因此旧分支续写天然安全。

### 2.3 新增 IPC

```rust
async fn set_agent_session_leaf(app, book_id, session_id, leaf_id) -> AppResult<LoadedPiSession>
```
返回重载后的 `LoadedPiSession`（携带新 leafId），前端免二次 load。

## 三、运行时（src/agent/runtime/embedded-runtime.ts）

```ts
async switchBranch(sessionId: string, targetLeafId: string): Promise<void>
```

- 前置校验：`this.bookId`、`this.session?.header.id === sessionId`、无活跃 `promptId`、目标 leaf 在当前内存 session 的 entries 中（避免陈旧状态）
- 调用 `sessions.setLeaf(...)`（SessionPort 新方法，底层 `set_agent_session_leaf`）
- 更新 `this.session`（替换为返回的 session 或就地更新 leafId）、`this.agent = null`（下个 prompt 重建，`ensureAgent` 会用新 activeBranch 的 piContextMessages）
- emit `branch_switched` 事件：`{ type: "branch_switched", bookId, sessionId, messages: visibleMessages(session) }`

**prompt 挂载修正**：现有 `prompt()` 中 `persistedLeaf = session.leafId`，编辑路径 `session.leafId = target.parentId` 后新分支从该点长出，非编辑路径挂当前 leaf——已天然兼容旧分支续写（leafId 是旧分支叶子，append 乐观锁放宽后 Rust 接受）。无需改 prompt 逻辑本身。

**switchSession / title 生成竞态**：`maybeGenerateTitle` 的 stale-leaf 检查（`session.leafId !== leafAtEnd`）基于重载的 session，切换分支后 `load()` 返回旁文件指针，行为正确。

## 四、Reducer / 事件（src/lib/agent-reducer.ts、src/types/agent.ts）

- `AgentEvent` 新增 `branch_switched: { bookId, sessionId, messages }`
- reducer 处理：`matchesBook` + `sessionId` 匹配 → 替换 `messages`，清 `compaction`，**保留 `promptId: null`、status 不变**（切换只在非流式时发生）
- UI 需要的分支导航信息：ChatPanel 从 runtime 侧获取。为避免每条消息传 Map，`branch_switched` 与 `session_switched` 事件**附带 `navigation: Record<anchorId, AnchorBranchInfo>`**（由 `branchNavigation()` 计算，JSON 可序列化）。AgentState 增加 `branchNavigation` 字段。

## 五、UI（src/components/chat/）

### 5.1 BranchSwitcher 组件（新文件）

- 位置：用户消息气泡下方（编辑按钮旁），仅当 `options.length > 1` 时渲染
- 形态：`[<] 2/3 [>]`，ChevronLeft / ChevronRight（lucide），边界禁用（不循环）
- disabled 当 `isStreaming`
- 点击 `[<]`/`[>]` → `onSwitch(targetAnchorId)` → runtime `switchBranch` 前，需要从 anchorId 解析到目标分支的 **leafId**：切换目标是"该分支的最深叶子"。计算函数放入 pi-session.ts：`branchLeafId(session, anchorId)` —— 从 anchor entry 出发沿子链走到无子节点为止。

### 5.2 ChatPanel 集成

- `state.messages.map` 渲染时，从 `state.branchNavigation` 查当前 index 对应 anchor 的分叉信息。问题：`state.messages` 是投影后的 UI 消息，索引与 anchor entry 的对应关系——`visibleMessages` 与 `visibleMessageEntries` 一一对应（同序同长，见 pi-session.ts:213 注释），而 ChatPanel 渲染的正是 `visibleMessages` 输出，故 `messages[index]` ↔ `visibleMessageEntries[index]`。需要 runtime 把 anchorId 数组随 navigation 一起传，或在 `branchNavigation` 的 key 上用 index 映射。**决定**：`branch_switched` / `session_switched` 附带 `anchors: string[]`（visibleMessageEntries 的 id 序列），reducer 存入 state，ChatPanel 用 `state.branchAnchors[index]` 查 navigation。
- 切换调用链：`ChatPanel.handleSwitchBranch(anchorId)` → `use-agent-bridge` 或直接 runtime 调 `switchBranch(sessionId, branchLeafId(...))`。ChatPanel 目前通过 props/bridge 拿 runtime（见 use-agent-bridge.ts），沿用现有模式。
- 编辑确认流程交互：`editingIndex` 状态在消息列表替换后天然失效（用户正在编辑的气泡可能消失）——切换前若有 `editingIndex !== null`，先取消编辑（复用 `handleCancelEdit` 语义）。
- i18n：新增 `chat.branchPosition` 之类文案（`{current} / {total}`），走 `src/locales` 现有模式。

## 兼容与迁移

- 旁文件不存在 → `load()` 回退 `entries.last()`，旧会话完全兼容
- JSONL 格式零改动，`validate_entry` / 迁移逻辑不动
- `firstKeptEntryId` compaction 与分支切换正交：compaction entry 在当前活跃分支上，`activeBranch()` 已处理

## 权衡记录

- **旁文件 vs header 内嵌指针**：header 改写违反 append-only 且需重写整个文件；旁文件一次原子写即完成，代价是多一个文件（`library::atomic_write` 已有）
- **branchNavigation 放前端 vs Rust**：树遍历是纯函数、TS 侧已有全部解码逻辑与测试基建，Rust 只管持久化职责更清晰
- **anchors 随事件传 vs UI 重算**：UI 侧拿不到 DecodedPiSession（reducer 只有投影消息），事件携带是唯一不改状态归属边界的方案

## 回滚

纯增量特性：旁文件删除后行为退回现状；UI 切换器无 navigation 数据时不渲染。逐文件 revert 安全。
