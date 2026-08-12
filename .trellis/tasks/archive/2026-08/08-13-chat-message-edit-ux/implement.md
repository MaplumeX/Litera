# 用户消息内联编辑 + 截断重发 — 执行计划

## Checklist

### 1. 协议 + sidecar

- [ ] `sidecar/protocol.ts`：`edit_prompt` 命令（`messageIndex` + `text` + 可选 `context`）和 `session_rewound` 事件（含 `messages`）。
- [ ] `protocol/agent-protocol.jsonl`：各加一条合法 command / event fixture。
- [ ] `sidecar/index.ts`：抽出 `startPrompt(...)`；新增 `handleEditPrompt`（定位 entry → 必要时对 readingContext parent 调 `navigateTree` → `session_rewound` → `startPrompt`）。
- [ ] 拒绝：无当前会话、index 越界、目标非 user、已有 activePrompt。

### 2. Rust

- [ ] `sidecar_protocol.rs`：镜像类型、validate、与 jsonl fixture 兼容。
- [ ] `sidecar.rs`：`agent_edit_prompt` + correlation + `SessionRewound` 转发。
- [ ] `lib.rs`：注册命令。

### 3. 前端逻辑

- [ ] `types/agent.ts`：`session_rewound`。
- [ ] `agent-reducer.ts`：替换 `messages`，保留本次 `promptId`。
- [ ] `agent-reducer.test.ts`：同书替换列表；跨书忽略。
- [ ] `use-agent-bridge.ts`：`editPrompt(messageIndex, text, context, message)`，先 `prompt_queued`，再 invoke；失败走 `prompt_queue_failed`。
- [ ] `use-agent-bridge.test.ts`：book 未就绪时不 invoke。

### 4. UI

- [ ] `ChatPanel`：`editingIndex`；保存调 `editPrompt`；流式中不允许进入编辑。
- [ ] `MessageBubble`：下方固定操作行；编辑态 textarea + 保存/取消。
- [ ] `AssistantMessage`：复制按钮改到内容下方固定行。
- [ ] 删除叠在正文上的 `absolute right-1 top-1` 按钮。

### 5. 验证

- [ ] `npm test`
- [ ] sidecar 协议测试（含共享 jsonl）
- [ ] `npm run build`
- [ ] 手动：编辑最后一条、编辑中间一条、取消、生成中不可编辑、复制、中止恢复输入、选段引用仍在。

## Validation Commands

```bash
npm test
npm run build
```

Sidecar 协议测试按仓库现有 `sidecar/scripts/protocol.node-test.ts` / package script 跑，不要另起一套。

## Review Gates

- `session.messages` 必须经 `navigateTree` 同步，禁止只改 `sessionManager.leafId`。
- 定位 entry 只走当前 branch，不用 `getUserMessagesForForking()`。
- `readingContext` parent 必须一起离开当前路径。
- `bookSnapshot` 必须留在路径上（或由现有 `sessionHasBookSnapshot` 补一次）。
- 按钮不得再 `absolute` 覆盖正文。
- 普通 `prompt` 命令形状不变。

## Rollback

单功能 commit 可整体 revert。已产生的 JSONL 分支节点可留在文件里，无害。
