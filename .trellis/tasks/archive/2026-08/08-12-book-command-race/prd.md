# Fix Command does not match the current book race

## Goal

消除"点进书里时 AI 对话界面偶发显示 `Command does not match the current book`"的竞态。根因是前端持有的 `bookId` 与 sidecar 进程内的 `currentBook` 在打开/切换/重启重放期间出现短暂不一致,前端在此窗口内发出的 `list_sessions` / `switch_session` / `prompt` 等命令被 sidecar `requireCurrentBook()` 拒绝。

## Background

- 报错来自 `sidecar/index.ts` `requireCurrentBook(bookId, ready=true)`:`!currentBook || currentBook.id !== bookId` → 抛 `Command does not match the current book`。
- 前端 `useAgentBridge` 的 `book_changed` effect(`src/lib/use-agent-bridge.ts:73-82`)在 `bookId` 变化时立即调用 `listSessions()`,且 `onSnapshot` 里 `switchSession(snapshot.sessionId)`;这两个命令早于 sidecar 处理完 `OpenBook` 就可能到达。
- sidecar 的 `currentBook` 在 `handleOpenBook` 中先置为 `loading`,再由 `bookWorkers.load(...)` 异步完成后置 `ready`;崩溃重启后由 Rust `replay_book` 重放 `OpenBook`,同样存在异步窗口。
- spec 已定义正确语义(`.trellis/spec/backend/tauri-commands.md` "Good/Base/Bad Cases"):打开 B 时只有 `book_ready(B)` 之后才允许输入;`open_book_bytes` 已确保 writer-queue acceptance 先于 EPUB 字节返回。

## Requirements

- R1 前端在 sidecar 未对当前 `bookId` 发出 `book_ready` 之前,不得向 sidecar 发送任何依赖 `currentBook` 的命令(`list_sessions` / `new_session` / `switch_session` / `delete_session` / `rename_session` / `agent_prompt`)。
- R2 `book_ready` 事件到达后,前端应主动刷新 session 列表并恢复/建立活动 session(保持现有自动切换体验)。
- R3 不得破坏现有乐观 `session_created` 语义(state-management spec):`session_created` 后不调用 `listSessions()` 覆盖乐观条目。
- R4 不得为消除竞态而降低侧car 的 `requireCurrentBook` 安全检查到允许跨书命令的程度;sidecar 仍应拒绝真正跨书的命令。
- R5 sidecar 重启重放场景:重放 `OpenBook` 完成(`book_ready`)前,前端由 snapshot hydrate 触发的 `switchSession` 也不得早于 `book_ready`;若 snapshot 携带 sessionId 但状态非 `bookReady`,应等待 `book_ready`。
- R6 修复不得引入新的轮询或多事件监听;沿用单 `agent_event` 订阅 + 纯 reducer + refs 模式(hook-guidelines)。
- R7 回归覆盖:新增/扩展测试,覆盖"快速 A→B 切换""sidecar 重启重放""首次进入书籍"三种场景下不再出现该错误,且 `book_ready` 仍驱动 session 列表刷新。

## Acceptance Criteria

- [ ] AC1 在慢机/大书(人为延迟 `bookWorkers.load`)条件下连续打开 A→B,前端日志与 sidecar 日志均无 `Command does not match the current book` 错误;B 的 session 列表正常显示。
- [ ] AC2 sidecar 崩溃重启后,前端在重放 `book_ready` 到达前不发 `list_sessions`/`switch_session`;重放完成后 session 列表与活动 session 正确恢复。
- [ ] AC3 首次进入书籍(无 snapshot sessionId)仍自动选中第一个 session(若有)或创建新 session(若列表为空),行为与现状一致。
- [ ] AC4 乐观 `session_created` 条目不被 `book_ready` 触发的 `listSessions()` 错误覆盖;`session_created` 后不调用 `listSessions()`。
- [ ] AC5 `agent_prompt` 在 `book_ready` 之前被禁用或排队,不会命中 `requireCurrentBook` 的 loading/不匹配分支。
- [ ] AC6 sidecar `requireCurrentBook` 仍拒绝真正跨书命令(保留单测或现有校验)。
- [ ] AC7 新增前端测试覆盖 reducer/bridge 在 `book_loading` → `book_ready` 期间不发命令;新增或扩展 sidecar/Rust 侧测试覆盖重放时序。

## Notes

- 修复主战场在前端 `use-agent-bridge.ts` 与可能的 `agent-reducer.ts` 状态门控;sidecar 的 `requireCurrentBook` 行为按 R4 保持。
- 复杂度判定:涉及前端时序重构 + 跨端时序测试,拟补 `design.md` + `implement.md`。