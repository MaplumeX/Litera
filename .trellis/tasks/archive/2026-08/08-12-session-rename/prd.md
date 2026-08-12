# 会话重命名

## Goal

允许用户修改 AI 助手会话的标题，新标题持久化到 sidecar 会话存储并同步到会话列表。

## Requirements

- 会话列表中每个会话提供重命名入口（如双击标题或编辑按钮）。
- 重命名后新标题持久化：重启应用、切换会话、重开书籍后仍显示用户设定的标题。
- 重命名后会话列表立即更新，无需手动刷新。

## Constraints

- 需扩展 sidecar 协议：新增 `rename_session` 命令 + `session_renamed` 事件。
- 需在 sidecar（Node）调用 `SessionManager.appendSessionInfo(name)` 持久化。
- 需在 Rust（`sidecar_protocol.rs` + `sidecar.rs`）镜像协议扩展并暴露 Tauri command。
- 需在前端（`types/agent.ts` + `agent-reducer.ts` + `use-agent-bridge.ts` + `ChatPanel.tsx`）处理新事件。
- `deriveTitle` 逻辑：`SessionInfo.name` 优先于 firstMessage 截断，已存在于 sidecar，重命名后 `SessionManager.list` 会自然返回新 name。

## Acceptance Criteria

- [ ] 会话列表中点击重命名入口可编辑标题，保存后列表立即更新。
- [ ] 重命名后重启应用，标题仍为新值。
- [ ] sidecar 协议新增 `rename_session` 命令与 `session_renamed` 事件，Rust 与 TS 类型同步。
- [ ] `protocol/agent-protocol.jsonl` fixtures 补充新命令/事件样例。
- [ ] 现有会话创建/切换/删除/列表流程无回归。
- [ ] `npm test` + `cargo test` 通过。