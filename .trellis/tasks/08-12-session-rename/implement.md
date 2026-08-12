# 会话重命名 — 执行计划

## Checklist

### 1. sidecar Node 协议扩展

- [ ] `sidecar/protocol.ts`：新增 `MAX_SESSION_TITLE_LENGTH = 128`。
- [ ] `SidecarCommand` 新增 `rename_session` 分支。
- [ ] `decodeCommand` 新增 case（校验 title 1-128）。
- [ ] `SidecarEvent` 新增 `session_renamed` 分支。
- [ ] `decodeEvent` 新增 case。

### 2. sidecar Node 处理逻辑

- [ ] `sidecar/index.ts`：新增 `handleRenameSession`。
- [ ] `handleStateCommand` switch 新增 `rename_session` case。

### 3. Rust 协议镜像

- [ ] `src-tauri/src/sidecar_protocol.rs`：`SidecarCommand` 新增 `RenameSession`。
- [ ] `SidecarEvent` 新增 `SessionRenamed`。
- [ ] `CommandEnvelope::validate` 新增分支。
- [ ] `EventEnvelope::validate` 新增分支。
- [ ] 新增 `MAX_SESSION_TITLE_LENGTH`。

### 4. Rust 命令与转发

- [ ] `src-tauri/src/sidecar.rs`：`command_correlation` 新增 `RenameSession`。
- [ ] 事件处理新增 `SessionRenamed` 转发分支。
- [ ] 新增 `rename_session` Tauri command。
- [ ] `src-tauri/src/lib.rs`：`invoke_handler` 注册 `rename_session`。

### 5. 前端类型与 reducer

- [ ] `src/types/agent.ts`：`AgentEvent` 新增 `session_renamed` 分支。
- [ ] `src/lib/agent-reducer.ts`：`applyEvent` 新增 `session_renamed` case。

### 6. 前端 bridge 与 UI

- [ ] `src/lib/use-agent-bridge.ts`：新增 `renameSession` 方法。
- [ ] `src/components/ChatPanel.tsx`：会话列表项加重命名按钮 + 行内编辑态。
- [ ] 保存调用 `bridge.renameSession`，错误回显到 `invokeError`。

### 7. 协议 fixtures

- [ ] `protocol/agent-protocol.jsonl`：补充 `rename_session` 命令 + `session_renamed` 事件样例。

### 8. 验证

- [ ] `npm test` 通过。
- [ ] `cargo test` 通过。
- [ ] `npm run build` 通过。
- [ ] 手动验证：重命名 → 列表更新 → 重启应用 → 标题保留。

## Validation Commands

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

## Review Gates

- 协议三层镜像（TS sidecar / Rust / TS frontend）必须类型对齐。
- `appendSessionInfo` 持久化后 `SessionManager.list` 必须返回新 name。
- 重命名时若 session 不在内存，`loadSessionFromDisk` 加载后操作，不报错。