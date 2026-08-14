# 为 agent 会话实现摘要压缩机制

## Goal

为 Litera 的嵌入式 agent 会话实现真正的摘要压缩(context compaction):当会话上下文接近模型 context window 时,用 LLM 生成旧消息的摘要,写入 `compaction` 条目,后续请求只发送摘要 + 最近保留的消息,替代现在的"12 回合硬截断直接丢弃"。

## 现状(已确认的代码事实)

- `src/agent/runtime/embedded-runtime.ts` 的 `ensureAgent()` 用 `windowCompleteTurns(piContextMessages(session), 12)` 初始化 agent 上下文:只保留最近 12 个用户回合 + 一个 `bookSnapshot` 自定义消息,旧消息**直接丢弃,不生成摘要**。
- 窗口截断只在 agent 创建时生效一次(agent 被缓存,`if(this.agent) return this.agent`)。
- `src/agent/sessions/pi-session.ts` 已完整支持 **读取端**:`activeBranch()` 找到最新 compaction 边界只保留其后消息;`piContextMessages()` 把 compaction 条目转成 `compactionSummary` 角色;`convertPiContextToLlm()` 包装成 `<summary>` 标签的用户消息。但**没有任何代码路径写入 compaction 条目**。
- pi-agent-core 的 `Agent` 支持 `transformContext` 钩子(convertToLlm 前转换上下文),但 Litera 未使用。
- 模型 contextWindow 来自 `resolveRuntimeModel()`(内置目录或自定义模型默认 128K)。
- session 持久化(Rust `pi_sessions.rs`)支持任意类型条目追加,compaction 条目格式: `{type:"compaction", summary, firstKeptEntryId, tokensBefore}`(v1 迁移逻辑已兼容)。
- assistant 消息携带真实 `usage`(pi-ai `AssistantMessage.usage`,agent-loop 透传,`decodeMessage` 保留整个 message 对象),可用于精确 token 计数。
- `isContextOverflow` / `isRecoverableLength` 已由 `@earendil-works/pi-ai` 导出(`utils/overflow.ts`),可直接复用。
- 测试基础设施:vitest + `createFauxCore` / `fauxAssistantMessage`(可自定义 usage)。

## 参考设计:pi coding agent 的压缩机制(已研究确认)

- **触发**:`shouldCompact(contextTokens, contextWindow, settings)` = `contextTokens > contextWindow - reserveTokens`(默认 reserve 16K)。token 数优先用最后有效 assistant 消息的真实 `usage`(跳过 aborted/error/全零),不可用时回退 chars/4 启发式估算。
- **溢出兜底**:`isContextOverflow()` 匹配 20+ 提供商错误模式 + silent overflow(usage.input > contextWindow)+ length-stop overflow;溢出时移除失败消息 → 压缩 → 自动重试一次。
- **防抖**:若最后有效 usage 的 assistant 消息时间戳早于最新 compaction 条目时间戳,跳过检查——防止压缩后立即再次触发。
- **切割点**:`findCutPoint()` 从最新往回累计估算 token,直到 ≥ `keepRecentTokens`(默认 20K);切割点可以是 user/assistant 消息,**绝不能是 toolResult**;切在回合中间时该回合前缀单独生成 turn-prefix 摘要。
- **摘要生成**:对话序列化为纯文本(`serializeConversation`,tool result 截断),结构化格式(Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context);有 previousSummary 时用 UPDATE prompt 迭代合并;摘要请求独立(`cacheRetention="none"` + 新 sessionId)。
- **持久化与重建**:写入 `{type:"compaction", summary, firstKeptEntryId, tokensBefore, details, usage}` 条目,然后 `agent.state.messages = buildSessionContext().messages` 重建上下文 = [compaction 条目] + [firstKeptEntryId 之后的消息]。

## Requirements

- 实现压缩的"写入端":触发检测 + 摘要生成 + compaction 条目持久化 + agent 上下文重建。
- 触发策略:阈值触发为主(真实 usage + chars/4 估算回退),溢出检测为兜底。
- 放宽 `windowCompleteTurns(..., 12)` 的 12 回合硬截断,让上下文完整增长,由压缩机制接管控制(否则压缩永远不会触发)。
- 防抖:压缩后不立即再次触发。
- 压缩失败时静默降级(不影响用户 prompt 结果,不阻塞后续对话)。
- 压缩在 prompt 流程内完成(回答后、promptId 清空前),避免并发。

## Acceptance Criteria

- [ ] 长会话(上下文 token 超过 contextWindow - reserve)触发压缩,写入 compaction 条目
- [ ] 压缩后 agent 上下文 = compactionSummary + 保留消息,后续 prompt 正常
- [ ] 压缩后不立即再次触发(防抖)
- [ ] 短会话不触发压缩
- [ ] 压缩失败不阻塞用户(静默降级)
- [ ] 现有测试全部通过,新增压缩相关单元测试

## Out of Scope(已确认决策)

- **不做**溢出自动重试(移除失败消息→压缩→重试):用户已确认不移植。溢出时仅压缩,用户可重发。
- **不做**压缩设置 UI(settings.json 配置):硬编码 `DEFAULT_COMPACTION_SETTINGS`。
- **不做**文件操作追踪(details.readFiles/modifiedFiles):pi 为编码场景设计,Litera 是阅读助手,无文件操作。
- **不做**turn-prefix 摘要(切在回合中间时):切割点落在 user 消息即可。

## Notes

- 压缩的"读取端"已存在,`activeBranch` / `piContextMessages` / `convertPiContextToLlm` 无需改动即可消费 compaction 条目。
