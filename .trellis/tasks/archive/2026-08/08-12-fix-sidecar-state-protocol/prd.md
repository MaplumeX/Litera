# 修复 Sidecar 状态与并发协议

## Goal

让 Rust、Node sidecar 和 React 对“当前书籍、当前会话、当前 prompt、进程状态”拥有一致且可恢复的认知，并消除主线程阻塞、乱序响应和监听泄漏。

## Requirements

- **SC-1**：打开新书时必须终止或隔离旧 prompt、清空旧活动会话，并确保工具和消息仅访问当前书籍。
- **SC-2**：所有命令与事件携带足够的 `requestId`、`bookId`、`sessionId`、`promptId` 或状态版本，前端可拒绝过期响应。
- **SC-3**：sidecar 状态变化按明确状态机顺序执行；只允许 abort 等必要控制消息旁路长时 prompt，禁止无约束的 `void` 异步竞态。
- **SC-4**：首次打开无会话书籍时用户可以直接提问，由系统建立有效会话；切换或删除活动会话时不会留下后台生成。
- **SC-5**：Tauri 命令不得持锁执行潜在阻塞的 stdin 写入；sidecar 写入通过有界队列或等价的非阻塞机制串行化。
- **SC-6**：Rust 监督 sidecar ready、book loading/ready、busy、error、terminated/restarting 状态，并提供可查询快照；进程异常退出后进行有界恢复或给出明确可重试状态。
- **SC-7**：React 监听注册在 StrictMode、快速卸载和重挂载下可完整清理；监听先建立再读取状态快照，并通过关联 ID/版本归并事件。
- **SC-8**：打开其他书、返回书库或关闭窗口时，Agent 生命周期与 UI 状态同步，不发生隐藏 API 消耗或旧事件污染。
- **SC-9**：sidecar 的 EPUB 解析/FTS 构建不得破坏控制消息响应性，且并发 book load 不得覆盖较新的书籍状态。

## Acceptance Criteria

- [x] 书 A 有活动会话、书 B 无会话时，在书 B 首次提问只会创建/写入书 B 会话。
- [x] A/B 快速切书、会话列表响应乱序和旧 `book_ready` 到达时，UI 与 sidecar 最终只显示最新书的状态。
- [x] 双击新建/切换/删除会话、流式生成中切换和连续 abort 均产生确定结果，不崩溃、不串会话。
- [x] sidecar 在加载大书或异常停止时，Rust 命令、abort 和窗口关闭不会无限阻塞 Tauri 主线程。
- [x] sidecar 退出会触发状态事件；恢复后重新建立当前书籍上下文和可恢复会话，或明确提示用户重试。
- [x] ChatPanel 在 StrictMode 双挂载、折叠/展开和返回书库后监听数不增长；重新挂载立即显示真实 ready/busy 状态。
- [x] Node 状态机/协议、Rust supervisor/转发和 React reducer/hook 均有自动化竞态回归测试。

## Constraints

- 保持本地 stdio JSONL 通信，不引入 localhost 网络服务。
- stdout 只输出协议 JSON，诊断信息继续走 stderr。
- 不放宽 WebView 权限或 CSP。
- 允许启用新的协议/会话存储版本并重置旧会话，不要求兼容旧 JSONL 会话文件。

## Out of Scope

- Agent 模型、工具能力和提示词重设计。
- 会话列表的视觉重设计。
