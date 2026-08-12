# 会话重命名 — 技术设计

## 协议扩展

### 新命令 `rename_session`

```jsonl
{"protocolVersion":1,"type":"rename_session","requestId":"r","bookId":"b","sessionId":"s","title":"新标题"}
```

字段：
- `requestId`、`bookId`、`sessionId`：同其他会话命令
- `title`：新标题，1-128 字符（复用 `MAX_ID_LENGTH` 上界不合适，新增 `MAX_SESSION_TITLE_LENGTH = 128`，与 `SessionSummary.title` 上界 1024 对齐但取更紧的 128）

### 新事件 `session_renamed`

```jsonl
{"protocolVersion":1,"seq":1,"type":"session_renamed","requestId":"r","bookId":"b","sessionId":"s","title":"新标题"}
```

字段：`requestId?`、`bookId`、`sessionId`、`title`。

## 四层改动

### Layer 1: sidecar Node（`sidecar/protocol.ts` + `sidecar/index.ts`）

**`protocol.ts`**：
- `SidecarCommand` 联合类型新增 `rename_session` 分支。
- `decodeCommand` 新增 case。
- `SidecarEvent` 联合类型新增 `session_renamed` 分支。
- `decodeEvent` 新增 case。
- 新增 `MAX_SESSION_TITLE_LENGTH = 128` 常量。

**`index.ts`**：
- 新增 `handleRenameSession(command)`：
  1. `requireCurrentBook(command.bookId)`
  2. 获取 managed session（内存优先，否则 `loadSessionFromDisk`）
  3. 调用 `managed.session.sessionManager.appendSessionInfo(command.title)`
  4. 发送 `session_renamed` 事件
- `handleStateCommand` switch 新增 `rename_session` case。

### Layer 2: Rust 协议（`src-tauri/src/sidecar_protocol.rs`）

- `SidecarCommand` enum 新增 `RenameSession { request_id, book_id, session_id, title }`。
- `SidecarEvent` enum 新增 `SessionRenamed { request_id?, book_id, session_id, title }`。
- `CommandEnvelope::validate` 新增 `RenameSession` 分支（校验 title 1-128）。
- `EventEnvelope::validate` 新增 `SessionRenamed` 分支。
- 新增 `const MAX_SESSION_TITLE_LENGTH: usize = 128;`。

### Layer 3: Rust 命令（`src-tauri/src/sidecar.rs` + `src-tauri/src/lib.rs`）

**`sidecar.rs`**：
- `command_correlation` 新增 `RenameSession` 分支。
- 事件处理 `SidecarEvent::SessionRenamed` 分支：更新 `snapshot` 无需（snapshot 不存标题），转发给前端 via `agent_event`。
- 新增 `pub fn rename_session(...)` Tauri command，发送 `SidecarCommand::RenameSession`。

**`lib.rs`**：
- `invoke_handler` 注册 `sidecar::rename_session`。

### Layer 4: 前端（`src/types/agent.ts` + `src/lib/agent-reducer.ts` + `src/lib/use-agent-bridge.ts` + `src/components/ChatPanel.tsx`）

**`types/agent.ts`**：
- `AgentEvent` 联合类型新增 `session_renamed` 分支。

**`agent-reducer.ts`**：
- `applyEvent` 新增 `session_renamed` case：`upsertSession` 更新标题 + `updatedAt`。

**`use-agent-bridge.ts`**：
- 新增 `renameSession(sessionId, title)` 方法，`invoke("rename_session", ...)`。

**`ChatPanel.tsx`**：
- 会话列表每项添加重命名按钮（`Pencil` 图标）。
- 点击进入行内编辑态（`editingSessionId` state + `editingTitle` state）。
- 保存调用 `bridge.renameSession(session.id, editingTitle)`。
- `session_renamed` 事件由 reducer 处理，列表自动更新。

## 数据流

```
[用户点击重命名] → 行内编辑 → 保存
  → bridge.renameSession(sessionId, title)
  → invoke("rename_session")
  → Rust 发 SidecarCommand::RenameSession
  → sidecar handleRenameSession
  → sessionManager.appendSessionInfo(title)  [持久化]
  → sendEvent(session_renamed)
  → Rust 转发 agent_event
  → reducer upsertSession(更新 title)
  → 会话列表 UI 更新
```

## 风险与权衡

- **`appendSessionInfo` 是追加而非修改**：SessionManager 是 append-only，多次重命名会产生多条 `session_info` entry，`getSessionName()` 返回最新一条。`SessionManager.list` 的 `name` 字段取最新 `session_info`，行为正确。
- **内存中 managed session 的 sessionManager 引用**：`AgentSession.sessionManager` 是 readonly 属性，可直接调用 `appendSessionInfo`。若 session 未在内存（已切换走），需 `loadSessionFromDisk` 加载后操作；但 `loadSessionFromDisk` 会重建 session 对象，开销略高。可接受。
- **title 长度限制**：sidecar 协议层 128 字符，Rust 镜像；前端不做硬限制，依赖后端校验 + 错误回显。