# Fix new session not appearing in list

## Goal

点击"新建会话"后,会话列表立即显示新会话条目,而不是因为后端空会话尚未落盘导致列表里看不到它。

## Background

- `handleNewSession` 在 sidecar 成功创建空会话并发 `session_created` 事件。
- 空会话因为没有 assistant 消息,`SessionManager._persist` 不写文件(pi 的设计,避免空文件堆积)。
- 前端收到 `session_created` 后调用 `listSessions()` 刷列表,但磁盘上还没有该会话文件,`SessionManager.list` 返回的列表不含新会话。
- 结果:用户看到"点击新建会话没用"——`currentSessionId` 已切换、消息已清空,但会话列表没有新条目,也没有高亮项。

## Requirements

- 前端在收到 `session_created` 事件时,乐观地把新会话插入会话列表,不依赖磁盘 list 结果。
- 新会话条目使用事件里的 `sessionId`、默认标题(如 "New Session")、当前时间作为 createdAt/updatedAt。
- 后续首次发消息落盘后,下一次 `listSessions` 自然用真实数据替换乐观条目,不产生重复。
- 不改 sidecar / SessionManager 落盘策略。

## Acceptance Criteria

- [ ] 点击"新建会话"后,会话列表立即出现新条目并被高亮为当前会话。
- [ ] 新会话条目在磁盘落盘前就可见;首次发消息后列表刷新不产生重复条目。
- [ ] 切书 / 重新打开书后,会话列表仍由磁盘 list 决定,乐观条目不残留。
- [ ] 构建通过 (`npm run build` 无类型错误)。

## Scope

- 仅改前端 reducer / 事件处理逻辑。
- 不改后端 sidecar、SessionManager、Tauri 命令。