# 用户消息内联编辑 + 截断重发 — 技术设计

## Architecture & Boundaries

四层同时加一条命令，模式对齐 `rename_session`。

| 层 | 文件 | 职责 |
|---|---|---|
| Sidecar 协议 | `sidecar/protocol.ts`, `protocol/agent-protocol.jsonl` | 编解码 `edit_prompt` / `session_rewound` |
| Sidecar 运行 | `sidecar/index.ts` | `navigateTree` + 复用 `handlePrompt` 后半段 |
| Rust | `src-tauri/src/sidecar_protocol.rs`, `sidecar.rs`, `lib.rs` | 镜像命令、校验、`agent_edit_prompt` |
| 前端 | `src/types/agent.ts`, `agent-reducer.ts`, `use-agent-bridge.ts`, `chat/*` | 事件替换消息列表、内联编辑 UI、按钮占位 |

不引入 `AgentSessionRuntime`，不新建会话文件。

## Protocol

### Command `edit_prompt`

```
{ protocolVersion: 1, type: "edit_prompt", requestId, promptId, bookId,
  messageIndex: number, text: string, context?: PromptContext }
```

- `messageIndex`：当前可见序列化列表（user+assistant）里被编辑那条的下标，从 0 计。必须指向 user。
- `text` / `context`：与 `prompt` 相同上限（`MAX_PROMPT_LENGTH` / `MAX_SELECTION_LENGTH`）。
- 必须已有当前会话。禁止在这里 `createSession`。

### Event `session_rewound`

```
{ protocolVersion: 1, seq, type: "session_rewound", requestId?, bookId, sessionId, promptId, messages }
```

`messages` 是截断后、尚未写入新 user 消息的可见列表。随后走与 `prompt` 相同的 `prompt_started` → deltas → `prompt_end`。

共享 fixture `protocol/agent-protocol.jsonl` 必须加一正一反样例（Node 与 Rust 都读这份文件）。

## Sidecar

`handleEditPrompt`:

1. `requireCurrentBook`；已有 `activePrompt` 则抛错（同 `prompt`）。
2. 必须有 `currentSessionId` 且 managed 属于本书。
3. 用 `getBranch()` 反转后的路径，按 `serializeMessages` 的规则取出 user/assistant entry，定位 `messageIndex`。对不上或不是 user → 协议/业务错误。
4. 若该 user entry 的 parent 是 `readingContext` custom message，对 **parent** 调 `navigateTree`；否则对 user entry 调 `navigateTree`。`summarize` 不传。
5. `sendEvent(session_rewound, { messages: serializeMessages(session.messages) })`。
6. 把剩余工作交给抽出来的 `startPrompt(managed, promptCorrelation, text, context)`（即现在 `handlePrompt` 里 snapshot / readingContext aside + `session.prompt`）。禁止把选段拼进 `text`。

不要用 `getUserMessagesForForking()`：它扫全文件，含旧分支。不要只调 `sessionManager.branch()`：不会同步 `agent.state.messages`。细节见 `research/pi-session-branch.md`。

## Rust

- `SidecarCommand::EditPrompt { request_id, prompt_id, book_id, message_index, text, context }`。
- `SidecarEvent::SessionRewound { request_id?, book_id, session_id, prompt_id, messages }`。
- `message_index` 必须是 `>= 0` 的整数；`text` 非空且不超过现有 prompt 上限。
- 新 Tauri 命令 `agent_edit_prompt`，enqueue 方式与 `agent_prompt` 相同。
- `command_correlation` 带上 `promptId`，以便排队失败时前端能对上。

## Frontend

### 数据流

```
Save
  → editPrompt(messageIndex, text, { selection, chapterIndex })
  → dispatch prompt_queued
  → invoke agent_edit_prompt
  → session_rewound 替换 state.messages
  → 本地 dispatch user_message（新文本 + 原 selection）
  → prompt_started / text_delta / prompt_end 与普通发送相同
```

`user_message` 仍由前端补，与现有 `prompt()` 一致：sidecar 不会单独推一条 user 事件。`session_rewound` 先把列表裁到截断点，再追加新 user，避免乐观截断失败后无法恢复。

`session_rewound` reducer：校验 bookId；用 `event.messages` 替换 `messages`；不要清 `promptId`（紧接着就是这次生成）。

失败：`prompt_queue_failed` / `error` 已有路径；编辑态在 invoke 出错时退回可再保存。

### UI

- `ChatPanel`：`editingIndex: number | null`。`handleEdit` 只设这个下标，不再 `setInput`。
- `MessageBubble`：非编辑态在气泡**下方**留操作行（编辑）；编辑态为 textarea + 保存/取消。Enter 保存，Shift+Enter 换行。
- `AssistantMessage`：复制按钮移到 markdown **下方**操作行。无 content 的 tool-only 消息仍不显示复制。
- 操作行始终占高（约图标按钮高度），hover 只改图标对比度。

## Compatibility

- 旧会话无需迁移。树分支是 v2+ 的既有能力。
- 三主题只用 token。
- `ChatPanelHandle.fillInput` 不变。
- 中止后恢复底部输入框的逻辑不变；编辑走另一条命令。

## Trade-offs

1. **独立 `edit_prompt`，不给 `prompt` 加可选 index**：普通发送路径零回归；多一个四层镜像命令，可接受。
2. **不做切换器**：旧回复只能从 JSONL 找回。换来协议和 UI 保持一条路径。
3. **`navigateTree` 而不是手写 `branch` + 赋值 messages**：少一次和 SDK 的不同步。
4. **选段不写入 serializeMessages**：重载会话后编辑不会复活引用。与今天切换会话就丢选段的行为一致，本轮不扩序列化。

## Rollback

- 纯增量命令/事件。revert 相关 commit 即可。未发过 `edit_prompt` 的会话文件不受影响。
- 已编辑过的会话 JSONL 会留下额外分支节点；回滚 UI 后这些节点只是不再被走到，不损坏文件。
