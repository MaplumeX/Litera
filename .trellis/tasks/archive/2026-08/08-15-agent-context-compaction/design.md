# 设计:agent 会话摘要压缩机制

## 目标

移植 pi coding agent 的压缩设计到 Litera 的嵌入式 agent runtime,实现"写入端":触发检测 + LLM 摘要生成 + compaction 条目持久化 + agent 上下文重建。

## 架构

```
src/agent/compaction/compaction.ts   ← 新增:纯函数 + 摘要生成(可单测)
src/agent/runtime/embedded-runtime.ts ← 修改:集成触发、持久化、上下文重建
src/agent/sessions/pi-session.ts     ← 不改(读取端已支持 compaction)
```

## 模块设计:compaction.ts

### 常量

```ts
export const DEFAULT_COMPACTION_SETTINGS = {
  enabled: true,
  reserveTokens: 16384,     // 触发阈值余量:contextTokens > contextWindow - reserveTokens
  keepRecentTokens: 20000,  // 切割点保留的最近 token 预算
};
```

### 纯函数(全部可单测)

| 函数 | 职责 |
|---|---|
| `estimateTokens(message)` | chars/4 启发式;user/assistant/custom/toolResult/compactionSummary 各角色分别统计(text/thinking/toolCall 块) |
| `estimateContextTokens(messages)` | 优先最后有效 assistant 消息的真实 `usage`(跳过 aborted/error/全零),其后消息用 `estimateTokens` 补估 |
| `shouldCompact(contextTokens, contextWindow, settings)` | `contextTokens > contextWindow - settings.reserveTokens` |
| `findCutPoint(entries, startIndex, endIndex, keepRecentTokens)` | 从最新往回累计估算 token ≥ keepRecentTokens;切割点可为 user/assistant,**不可为 toolResult**;返回 `{firstKeptEntryIndex, turnStartIndex, isSplitTurn}` |
| `prepareCompaction(entries, settings)` | 定位上一个 compaction 边界(previousSummary + boundaryStart);计算 tokensBefore;findCutPoint;收集 messagesToSummarize;返回 `{firstKeptEntryId, messagesToSummarize, previousSummary, tokensBefore}` 或 undefined(无可压缩内容) |
| `serializeConversation(messages)` | 序列化为 `[User]:` / `[Assistant]:` / `[Tool result]:` 纯文本,tool result 截断(防模型当对话继续) |

### 摘要生成

```ts
export async function generateSummary(
  messages: AgentMessage[],
  model: Model<Api>,
  reserveTokens: number,
  apiKey: string,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,          // 复用 agent.streamFunction(带 guarded fetch)
  previousSummary?: string,
): Promise<string>
```

- 结构化摘要 prompt(Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context),与 pi 一致
- 有 previousSummary 时用 UPDATE prompt 迭代合并(保留旧信息 + 新增)
- 请求:单条 user 消息包 `<conversation>` 标签 + system prompt(SUMMARIZATION_SYSTEM_PROMPT)
- `maxTokens = min(floor(0.8 * reserveTokens), model.maxTokens)`
- options:`{ maxTokens, signal, apiKey, cacheRetention: "none", sessionId: uuidv7() }`(独立请求,避免污染缓存)
- 通过 `streamFn(model, context, options).result()` 调用(与主对话同一条 stream 通道,复用 guarded fetch)
- 返回摘要文本;失败抛错由调用方降级

## 集成:embedded-runtime.ts

### 1. 放宽 12 回合硬截断(关键前提)

`ensureAgent()` 中 `messages: windowCompleteTurns(piContextMessages(session), 12)` 改为 `messages: piContextMessages(session)`。

**原因**:若保留 12 回合限制,agent 上下文永远只有 12 回合,usage 永远不会接近 contextWindow,压缩永远不会触发。压缩机制接管上下文控制后,`windowCompleteTurns` 不再需要(保留函数本身,供测试/未来使用)。

### 2. 新增 `maybeCompact()` 方法

```ts
private async maybeCompact(
  agent: Agent,
  session: DecodedPiSession,
  bookId: string,
): Promise<boolean>  // 返回是否执行了压缩
```

流程:
1. **防抖**:取最后有效 usage 的 assistant 消息,若其 timestamp ≤ 最新 compaction 条目 timestamp,跳过(压缩后不立即再触发)
2. **token 计算**:优先最后有效 usage(`calculateContextTokens`),否则 `estimateContextTokens(agent.state.messages)`
3. **阈值**:`shouldCompact(contextTokens, model.contextWindow, settings)`;不满足则返回 false
4. **溢出兜底**:最后 assistant 消息 `isContextOverflow(msg, contextWindow)` 也触发(独立于阈值)
5. **准备**:`prepareCompaction(activeBranch(session), settings)`;undefined 则跳过
6. **生成**:`generateSummary(...)` 用 `agent.streamFunction` + `agent.state.model` + `config.apiKey`
7. **持久化**:`newEntry("compaction", session.leafId, { summary, firstKeptEntryId, tokensBefore })` → `sessions.append` → `session.entries.push` / `session.leafId` 更新
8. **重建**:`agent.state.messages = piContextMessages(session)`(compactionSummary + 保留消息)
9. 失败(网络/解析):catch 静默,返回 false,不阻塞

### 3. prompt 流程集成

```
ensureAgent()
→ maybeCompact(agent, session, bookId)          // pre-prompt:基于估算,防首次 prompt 溢出
→ agent.prompt([...promptMessages, user])
→ persist completed 消息
→ maybeCompact(agent, session, bookId)          // post-prompt:基于最后 assistant 真实 usage
→ emit prompt_end / prompt_aborted
```

- 压缩在 try 块内、`finally` 清空 promptId 之前执行 → 压缩期间 promptId 仍占用,无并发竞态
- 压缩失败静默降级,不影响 prompt_end 发出

### 4. 事件

不新增 UI 事件(压缩对用户透明)。可选:在 `prompt_end` 前压缩,UI 感知为"回答完成后短暂延迟"。

## 边界情况

| 场景 | 处理 |
|---|---|
| 会话太短/无可压缩内容 | `prepareCompaction` 返回 undefined,跳过 |
| 最后条目已是 compaction | `prepareCompaction` 返回 undefined(已压缩过) |
| 压缩 LLM 调用失败 | catch 静默,返回 false,不阻塞用户 |
| 压缩期间用户发新 prompt | 不可能:promptId 在压缩完成前未清空 |
| 历史已超限的首次 prompt | pre-prompt 检查先压缩再 prompt |
| 模型切换后 | `model_change` 条目已记录;压缩用当前 agent.state.model |
| 编辑消息(rewind)后 | session.leafId 回退,activeBranch 从编辑点重建;压缩基于当前分支 |

## 不做的事(明确排除)

- **不做**溢出自动重试(移除失败消息→压缩→重试):复杂度高,与压缩机制本身可分离;溢出时仅压缩,用户可重发
- **不做**压缩设置 UI(settings.json 配置):硬编码 DEFAULT_COMPACTION_SETTINGS
- **不做**文件操作追踪(details.readFiles/modifiedFiles):pi 为编码场景设计,Litera 是阅读助手,无文件操作
- **不做**turn-prefix 摘要(切在回合中间时):Litera 单轮 prompt 结构简单,切割点落在 user 消息即可;`findCutPoint` 保留 isSplitTurn 逻辑但 prepareCompaction 简化处理(若切在回合中间,直接以该回合 user 消息为边界)

## 兼容性

- compaction 条目格式与 pi-session.ts 读取端完全兼容(`{type, id, parentId, timestamp, summary, firstKeptEntryId, tokensBefore}`)
- Rust 端 `validate_entry` 接受任意类型条目,无需改动
- 旧会话(无 compaction)不受影响,首次压缩正常触发
