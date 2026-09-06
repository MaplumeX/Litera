# Implement: ChatGPT 式消息分支切换

## 顺序清单

### 阶段 1：数据层（pi-session.ts）
- [x] 1.1 新增 `branchNavigation(session): Map<anchorId, AnchorBranchInfo>`（含 `BranchOption` 类型）
  - 兄弟分支 = 同一 parentId 下各后代路径的首条用户消息；按 timestamp 排序；仅 `options.length > 1` 时入 Map
  - 测试：单线会话无分叉；编辑一次 → 2 分支；两次编辑同一消息 → 3 分支；编辑不同消息 → 各自独立分叉；timestamp 排序；compaction 后分支仍正确
- [x] 1.2 新增 `branchLeafId(session, anchorId): string | null`（沿子链走最深叶子；多子取 timestamp 最新的子链）
  - 测试：线性链、分叉处、锚点不存在返回 null
- 验证：`npx vitest run src/agent/sessions/pi-session.test.ts`

### 阶段 2：Rust 持久化（pi_sessions.rs）
- [x] 2.1 旁文件 helpers：`leaf_path()`、读（存在性校验）、原子写
- [x] 2.2 `load()`：优先旁文件 leafId（须在 entries 中），回退 `entries.last()`
- [x] 2.3 `append()`：乐观锁放宽（`Some(id)` 只要求存在于 id 集合；`None` 要求 entries 为空）；成功后更新旁文件为新 leaf
- [x] 2.4 `set_leaf(book_id, session_id, leaf_id)`：校验 leafId 存在 → 写旁文件 → 返回 LoadedPiSession
- [x] 2.5 `delete()`：删除旁文件
- [x] 2.6 IPC `set_agent_session_leaf` + lib.rs 注册 + tauri-commands.md spec 更新
- [x] 2.7 Rust 测试：旧分支 append 成功；陈旧 leaf append 拒绝；set_leaf 后 load 返回该 leaf；旁文件缺失回退 last；delete 清理旁文件
- 验证：`cd src-tauri && cargo test`
- 回滚点：此阶段独立可 revert

### 阶段 3：TS 传输层（session-port.ts）
- [x] 3.1 `SessionPort` 新增 `setLeaf(bookId, sessionId, leafId): Promise<DecodedPiSession>`；tauriSessionPort 调 `set_agent_session_leaf`
- 验证：`npx tsc --noEmit`

### 阶段 4：运行时 + reducer
- [x] 4.1 `AgentEvent` 新增 `branch_switched`；`session_switched` / `branch_switched` 附带 `anchors: string[]` 与 `navigation: Record<string, AnchorBranchInfo>`（另：`prompt_end` / `prompt_aborted` 也附带 `messages` + `anchors` + `navigation`，覆盖编辑产生新分支后 UI 刷新的缺口）
- [x] 4.2 `LiteraAgentRuntime.switchBranch(sessionId, targetLeafId)`：校验（bookId / sessionId / 无 promptId / leaf 在内存 entries 中）→ `sessions.setLeaf` → 更新 session、`agent=null` → emit
- [x] 4.3 `switchSession` emit 时附带 anchors + navigation
- [x] 4.4 reducer：`AgentState.branchNavigation` / `branchAnchors` 字段；处理事件；`book_changed` / `book_loading` 等重置
- [x] 4.5 runtime 测试（embedded-runtime.branch.test.ts）+ agent-reducer 测试
- 验证：`npx vitest run src/agent src/lib/agent-reducer.test.ts`

### 阶段 5：UI
- [x] 5.1 `BranchSwitcher.tsx`：`< 2/3 >` 组件（props: current, total, disabled, onPrev, onNext）+ 测试
- [x] 5.2 ChatPanel：用 `state.branchAnchors[index]` 查 `state.branchNavigation` 渲染切换器；切换前取消进行中编辑；调 runtime `switchBranch(sessionId, branchLeafId)`
  - 注意：ChatPanel 不持有 DecodedPiSession，`branchLeafId` 的调用需要 session——由 bridge 层封装（见 5.3）
- [x] 5.3 `use-agent-bridge.ts`：暴露 `switchBranchAtAnchor(anchorId, direction)`（内部由 runtime `switchBranchAtAnchor(sessionId, anchorId, direction)` 用内存 session 计算 leafId）
- [x] 5.4 i18n 文案（`chat.branchPrev` / `chat.branchNext`，zh/en）
- [x] 5.5 ChatPanel 测试：分叉消息显示切换器、点击切换触发调用、无分叉不显示、流式禁用、编辑态切换先取消
- 验证：`npx vitest run`

### 阶段 6：收尾
- [x] 6.1 全量验证：`npx tsc --noEmit && npx vitest run`（TS 改动未触及 Rust，cargo 测试/clippy 跳过）
- [ ] 6.2 手动冒烟（Tauri dev）：编辑消息产生分支 → 切换 → 旧分支续写 → 重启应用仍在旧分支（用户执行）

## 风险文件

- `src-tauri/src/pi_sessions.rs`（乐观锁语义变化——append 兼容性是最高风险点，测试必须覆盖陈旧 leaf 拒绝场景）
- `src/agent/runtime/embedded-runtime.ts`（prompt 竞态，改动集中在 switchBranch 新方法，不动 prompt 主体）
- `src/lib/agent-reducer.ts`（事件新增字段向后兼容：anchors/navigation 为可选）

## review 门

- 阶段 2 完成后（Rust 边界稳定）与阶段 4 完成后（事件契约稳定）各跑一次 trellis-check
