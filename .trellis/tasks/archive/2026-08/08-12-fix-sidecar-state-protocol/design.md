# Technical Design

## Dependencies

本子任务最后实施：

- 依赖 `fix-library-persistence-safety` 提供受控书籍路径和重置后的 session 根。
- 依赖 `fix-sidecar-packaging-ipc` 提供 externalBin、Tauri shell transport 和 Raw IPC 后的新 open flow。

## Protocol Envelope

Rust → sidecar 命令统一为判别联合，每条都有 `requestId`：

```typescript
type SidecarCommand =
  | { type: "ping"; requestId: string }
  | { type: "open_book"; requestId: string; bookId: string; path: string; sessionsDir: string }
  | { type: "prompt"; requestId: string; promptId: string; bookId: string; text: string; context?: PromptContext }
  | { type: "abort"; requestId: string; promptId?: string }
  | { type: "list_sessions"; requestId: string; bookId: string }
  | { type: "new_session"; requestId: string; bookId: string }
  | { type: "switch_session"; requestId: string; bookId: string; sessionId: string }
  | { type: "delete_session"; requestId: string; bookId: string; sessionId: string };
```

sidecar → Rust 事件必须带 `type`、`requestId?`、`bookId?`、`sessionId?`、`promptId?` 和 sidecar-local `seq`。Rust supervisor 为每次进程启动分配 `generation`，并在转发前增加全局单调 `version`。

前端只监听一个 `agent_event` 判别联合，不再分别维护 `agent_*` 与 `session_*` 的私有 payload 定义。工具事件增加 `toolCallId`，结束事件按 ID 匹配，不能再使用“第一个未完成工具”。

## Node State Machine

Node 明确维护：

```text
currentBook: { id, generation } | null
currentSessionId: string | null
activePrompt: { promptId, bookId, sessionId, task } | null
phase: idle | loading_book | ready | prompting | stopping
```

### Serialized dispatcher

- `open_book`、new/switch/delete/list session 等状态命令进入串行 dispatcher。
- `prompt` 在验证/自动建立会话后登记 activePrompt，并启动受跟踪的异步任务，dispatcher 不等待整个模型响应。
- `abort` 是唯一旁路控制命令，可立即针对 activePrompt 调用 session abort。
- 切书、切/删活动会话前先 abort 并等待旧 prompt 有界结束，再改变状态。
- 第二个 prompt 在已有 activePrompt 时返回 scoped busy error，不并发调用同一 session。

### Book switch

打开新书的第一步清除当前会话并使旧 book generation 失效。book load 成功后才发送 `book_ready(bookId)`；失败保持 currentBook null。任何旧 load 结果都因 generation 不匹配被丢弃。

### First prompt

当前书没有活动会话时，`prompt` 自动创建该书的新会话，再开始生成，使 UI 的“直接提问”行为成立。

## Responsive Book Engine

EPUB 解压、章节提取和 FTS 构建从主 sidecar 控制循环隔离到 `BookWorker`：

- worker 独占当前书的 AdmZip/FTS 状态。
- main sidecar 与 worker 使用带 request ID 的消息 RPC；Agent tools 的 execute 变为 await worker RPC。
- worker load 结果同样带 book generation，旧结果不能覆盖新书。
- packaging 实现可选择 worker thread 或同一 packaged executable 的内部 worker 模式，但必须证明加载大书时 main loop 仍能响应 ping/abort/terminate。

## Rust Supervisor

建议提取模块：

```text
src-tauri/src/
├── sidecar.rs          # supervisor actor, transport, snapshot, Tauri commands
└── sidecar_protocol.rs # serde command/event enums and validation
```

Supervisor actor 独占 child handle；Tauri commands 只通过有界 channel 发送 typed command。actor 负责：

- 逐行 framing/解析 stdout，拒绝畸形或缺字段事件。
- 在 emit 之前更新 `AgentSnapshot`。
- 保存最后成功的 book descriptor 与 session ID，用于重启恢复。
- 收到 terminated/error 后清除 active prompt，增加 generation，emit terminated/restarting。
- 以有界退避自动重启若干次；ready 后重放 open_book，book_ready 后尝试恢复 session，但绝不重放未完成 prompt。
- 自动重启耗尽后进入 unavailable；`restart_sidecar` 命令允许用户重试。
- shutdown 标记阻止窗口关闭时触发重启，kill 后有界 wait/reap 子进程。

所有进 supervisor 的队列都有容量；满时命令快速返回 Busy/Unavailable，不阻塞主线程。

## Agent Snapshot

Rust 管理可序列化快照：

```typescript
interface AgentSnapshot {
  version: number;
  generation: number;
  status: "starting" | "ready" | "loadingBook" | "bookReady" | "prompting" | "restarting" | "unavailable";
  bookId?: string;
  sessionId?: string;
  promptId?: string;
  error?: { scope: string; message: string };
}
```

`get_agent_snapshot` 是即时 Tauri command。React 的订阅顺序是：

1. 注册唯一 `agent_event` listener。
2. 调用 `get_agent_snapshot`。
3. reducer 只接受 `version >= current.version` 的快照/事件，并校验 book/session/prompt 关联。

因此启动 ready、book_ready 或卸载期间事件即使发生，也能从快照恢复。

## React Lifecycle

- 抽取 `useAgentBridge` 与纯 `agentReducer`；shared event types 位于 `src/types/agent.ts`。
- 单个 `listen()` Promise 使用 disposed flag：若卸载后才返回，立即调用该 unlisten；正常 cleanup 调用已注册 unlisten。
- bookId 变化通过 reducer action 重置可见状态，并从 snapshot/list response 重新水合。
- ChatPanel 折叠可继续卸载，因为状态能从快照与 session history 恢复；返回书库时显式发送 `close_book`/abort，避免隐藏生成。
- session actions 在 active prompt 时禁用，后端仍做最终状态校验。
- scoped error 只影响匹配操作；list session 错误不能错误地把 prompt streaming 置为 false。

## Process Recovery Semantics

- 自动重启只恢复当前书和已落盘会话，不恢复/重放正在生成的 prompt。
- 重启事件让前端把旧 prompt 标记为中断并允许重试。
- 无当前书时只恢复 ready。
- 旧 generation 的 stdout/events 一律丢弃。

## Security and Validation

- Rust 与 Node 都从 `unknown`/generic JSON 解码到唯一协议 enum/guard，不在消费者处散落字段 cast。
- 书路径只由 Rust LibraryStore 提供；前端不能通过 sidecar command 提交任意路径。
- 限制单条 JSONL 命令和 prompt/selection 长度；stdout line framer 也设置上限。
- 不在协议错误中回显完整敏感 prompt 或本地文件路径。

## Rollback

- 先建立纯状态机/协议测试，再替换旧 command/event 名称。
- Rust、Node、React 在一个子任务提交内切换到新 envelope，旧事件不并存。
- supervisor 自动重启最后接入；基础 typed transport 和快照通过后再启用 replay。
