# Multi-Session Management + List UI

## Goal

从单 inMemory session 升级为每书多会话 + 持久化 + 列表 UI。用户可新建/切换/删除会话，重开书恢复历史。

## Parent Reference

父任务：`08-11-agent-epub-reader`。本子任务对应 `implement.md` Child 5。依赖 Child 4（已完成：阅读助手整合）。

## Requirements

### sidecar 端
- 单 AgentSession → 自管 `Map<sessionId, AgentSession>`（每个会话独立 `createAgentSession` + `SessionManager.create`）
- 会话持久化：存储路径 `sessions/<bookId>/<sessionId>.jsonl`（Tauri app data 目录下）
- bookId 计算：epub metadata identifier（优先）或文件路径 hash（fallback）
- 实现会话命令：
  - `list_sessions` → 返回 `[{ id, title, createdAt, updatedAt }]`
  - `new_session` → 新建 AgentSession，返回 sessionId
  - `switch_session` → 切换活跃会话，载入历史 messages 返回
  - `delete_session` → 释放会话 + 删 jsonl 文件
- 会话标题：首条用户消息截断前 30 字符
- 当前会话切换时：暂停旧 subscribe，载入新会话 messages，重新 subscribe
- bookId 与 epub 解析状态全局保留（换会话不换书，FTS5 索引/章节缓存不变）

### Rust 端
- IPC commands：`list_sessions` / `new_session` / `switch_session` / `delete_session`
- 转发 sidecar stdio 命令 + 返回结果
- `open_file` 成功后自动调 `list_sessions(bookId)` → 前端默认切到最近更新的会话
- sidecar `session_switched` 事件 → emit 到 WebView（含 messages 历史）

### WebView 端
- 会话列表 UI：ChatPanel 顶栏"会话列表"按钮 → 覆盖式展开 → 列表 + "+ 新建会话" + 每条可删除
- 切换会话时清空当前消息，渲染新会话历史
- 首条用户消息自动设置会话标题

## Acceptance Criteria

- [ ] sidecar 支持多会话（Map<sessionId, AgentSession>）
- [ ] 会话持久化到 `sessions/<bookId>/<sessionId>.jsonl`
- [ ] `list_sessions` 返回会话摘要列表
- [ ] `new_session` 创建新会话
- [ ] `switch_session` 切换并载入历史
- [ ] `delete_session` 删除会话 + jsonl 文件
- [ ] 会话标题 = 首条用户消息前 30 字符
- [ ] Rust IPC commands 注册
- [ ] `open_file` 后自动 list_sessions + 默认切到最近会话
- [ ] 前端会话列表 UI（覆盖式展开 + 新建 + 切换 + 删除）
- [ ] 切换会话时清空消息 + 渲染历史
- [ ] `npm run build` + `cargo check` + `cd sidecar && npx tsc --noEmit` 通过

## Out of Scope

- 会话重命名（v2）
- 跨书全局会话列表（v2）
- 会话搜索（v2）
- 会话导出（v2）