# Design: Agent runtime iteration

## 总体

六项改动彼此独立，但都落在 runtime 事件链路（embedded-runtime → AgentEvent → agent-reducer → ChatPanel）或配置链路（agent_config.rs → model-resolution.ts）上。按风险从低到高排序实施：R9（删除）→ R1（错误区分）→ R2（重试）→ R3（模型窗口配置）→ R7（thinking 透传）→ R5（标题生成）。

## R1 错误信息区分

**现状**：`embedded-runtime.ts` `prompt()` 的 catch 把一切异常替换为「模型请求失败，请检查配置后重试」。`native-fetch.ts` 出于安全不回显原生错误文本。

**设计**：新增 `src/agent/runtime/prompt-error.ts`，提供纯函数 `classifyPromptError(error: unknown): { code: PromptErrorCode; message: string }`：

- `auth`（401/403）→「API Key 无效或无权限，请检查模型配置」
- `rate_limited`（429）→「请求过于频繁或配额不足，请稍后重试」
- `server`（5xx）→「模型服务暂时不可用，请稍后重试」
- `network`（fetch 失败）→「网络连接失败，请检查网络与提供商地址」
- `context_overflow`（复用 `isContextOverflow` 判定结果）→「对话过长，已尝试压缩但上下文仍超限」
- `unknown` → 保持现有兜底文案

**错误来源识别**：pi-ai 流式调用失败时错误信息会带 HTTP 状态描述；`classifyPromptError` 用模式匹配（`/\b401\b|unauthorized|invalid.*key/i` 等正则 + `isRetryableAssistantError` 的反面）对 message 做分类。**安全约束**：只输出预置中文文案，绝不拼接原始错误文本（延续 native-fetch 的不回显原则）。

`prompt()` 的 catch 改为：先检查 `isContextOverflow`（现有逻辑已部分覆盖），再走 `classifyPromptError`，`error` 事件的 `message` 用分类文案，`scope` 仍为 `"prompt"`。

**测试**：`prompt-error.test.ts` 对每类输入断言分类与文案；不需要网络。

## R2 请求重试

**现状**：`ensureAgent` 中 `{...options, fetch: nativeFetch, maxRetries: 0}`。

**设计**：pi-ai 的 `maxRetries`（`StreamOptions` 层，types.d.ts:93）控制 SDK 级重试；pi-ai 另有 `retryAssistantCall`（`RetryPolicy`）供 SDK 之外包一层。两者选其一即可——**选 SDK 级 `maxRetries`**：

- 把 `maxRetries: 0` 改为 `maxRetries: 3`。SDK 级重试天然满足「流式首字节前才重试」与指数退避（OpenAI/Anthropic SDK 内置行为，pi-ai 透传）。
- `retry_scheduled` 事件：SDK 重试在内部进行，runtime 无法观测到每次退避。为满足 AC2「UI 有重试提示」，改为**请求级兜底**：`prompt()` 外层用 `retryAssistantCall` 包住整次 `agent.prompt()`（`RetryPolicy { enabled: true, maxRetries: 3, baseDelayMs: 500 }`），`onRetryScheduled` 回调 emit `retry_scheduled` 事件。两层并存时 SDK 内部静默重试、外层只在整体失败后重试，事件只在外层触发——可接受（外层重试罕见，静默 SDK 重试无感即成功）。
- 401/403/上下文超限由 `isRetryableAssistantError` 自动排除，不重试。

**取舍记录**：`retryAssistantCall` 需要 `produce: () => Promise<AssistantMessage>`。`agent.prompt()` 返回 void，需用 `agent.state.messages` 尾部 assistant 消息构造返回值；若 `agent.prompt()` 抛异常则直接 rethrow 让 retry 判定。abort 信号透传 `agent.abort()` 已有路径。

**测试**：mock `streamFn` 前两次 429、第三次成功，断言 `retry_scheduled` 事件次数与最终 `prompt_end`。

## R3 自定义模型窗口自动解析（方案 A）

**目标**：`custom-*` 模型不再写死 128k/8192，按三层解析，无手动填写 UI。

**三层解析（`model-resolution.ts`）**：
1. **pi-ai 内置目录优先**：custom provider 的模型 id 先在 pi-ai 全 provider 目录中查找。实现：`resolveRuntimeModel` 新增第一步——遍历/索引所有内置 provider 的目录（构建一个 `Map<modelId, Model>`，模块级懒加载缓存），命中且 `api` 与配置一致则返回该目录项（保留 custom provider 的 baseUrl/key，但用目录的 contextWindow/maxTokens）。
2. **`/models` 探测**：未命中时拉 `{baseUrl}/models`（Rust 已有 `list_remote_models` 命令与 `models_endpoint_url` 路径，复用其 reqwest 请求；新增解析逻辑读取 OpenRouter 的 `context_length` 与 vLLM 的 `max_model_len`）。探测到的 contextWindow 透传给前端。maxTokens 无可靠探测源，取 `contextWindow / 8`。
3. **默认值兑底**：前两层都未命中 → 维持现状 128_000/8_192。

**数据流**：`read_runtime_config`（Rust）在 custom 分支中：目录命中逻辑在前端做（前端能访问 pi-ai 目录，Rust 不能）；Rust 只负责第 2 层——`AgentRuntimeConfig` 增加 `context_window: Option<u64>`（来自 `/models` 探测缓存或实时探测），前端 `resolveRuntimeModel` 依次取「目录命中 ?? 探测值 ?? 默认」。

**探测时机与缓存**：在 `add_custom_provider` / `update_custom_provider` 保存时探测一次并写入 models.json（`contextWindow` 可选字段，serde skip_serializing_if None）；保存时探测失败则不写字段，运行时不重试（避免每次 prompt 加网络延迟）。旧文件无字段 → 前端目录查找 → 默认值，完全向后兼容。

**安全**：探测请求同 `list_remote_models` 现有约束（HTTP(S)、key 仅用于该请求）；解析字段仅取数字，不回显响应体。

**不做**：手动填写 UI、溢出自适应 compaction 重试（方案 A 明确排除，用户确认）。

**测试**：`model-resolution.test.ts` 三层各有命中/未命中用例（目录命中 deepseek-v4-pro → 1M；目录未命中 + 探测值 → 用探测值；两者皆无 → 128k）；Rust 侧探测解析单测（mock JSON 含/不含 `context_length`/`max_model_len`）。

## R7 thinking 透传

**事件类型**（`src/types/agent.ts` 扩展，不改既有事件）：

```ts
| ({ type: "thinking_start"; contentIndex: number } & PromptCorrelation)
| ({ type: "thinking_delta"; delta: string; contentIndex: number } & PromptCorrelation)
| ({ type: "thinking_end"; contentIndex: number } & PromptCorrelation)
```

**runtime**：`onPiEvent` 在 `message_update` 分支下新增对 `assistantMessageEvent.type === "thinking_start" | "thinking_delta" | "thinking_end"` 的转发（与 text_delta 并列）。

**reducer**：`AgentMessage` 增加可选 `thinking?: string` 字段；`thinking_delta` 追加到 `updateLastAssistant` 的 `thinking`；`thinking_end` 不改内容（内容即累计 delta）。

**UI**：`AssistantMessage.tsx` 增加「思考过程」可折叠块（默认折叠，流式期间自动展开，`prompt_end` 后收起）。样式对齐现有 `ToolCallCard` 的折叠模式。usage/cost 一律不透传不显示（用户决策）。

**测试**：reducer 事件流测试覆盖三个事件；组件测试覆盖折叠渲染。

## R5 会话标题自动生成

**触发点**：`embedded-runtime.ts` `prompt()` 末尾、`prompt_end` 发出之后——fire-and-forget 异步任务，不阻塞返回。条件：本次 prompt 是该 session 的**第一轮**（append 前分支中无 user message，除刚写入的）且正常结束（非 abort）。

**流程**：
1. 取本轮首条 user 消息 + 最终 assistant 回复文本（各截 ~2000 字符）。
2. 复用 `agent.streamFunction`，独立 `sessionId`、`cacheRetention: "none"`、`maxTokens: 64`，prompt 为「用用户的语言生成不超过 20 字的会话标题，只输出标题」。
3. 成功：复用 `renameSession` 内部逻辑追加 `session_info` entry，emit `session_renamed`（UI 列表自动刷新）。加保护：若期间用户已手动改名（对比 leaf 链上最新 `session_info` 时间戳晚于标题任务启动时间则放弃）。
4. 失败：静默吞掉（log），标题保持 `first_user_text` fallback——Rust 侧无需改动。
5. 防泄漏：标题请求走同一 `nativeFetch` 守卫。

**测试**：mock streamFn 成功/失败两路；断言成功时 `session_renamed` 发出且 entry 落库；失败时无事件、无异常。

## R9 死代码清理

- 删除 `src/agent/runtime/pi-spike.ts`、`pi-spike.test.ts`。
- 删除 `pi-session.ts` 的 `windowCompleteTurns`；`pi-session.test.ts` 中对应 describe 块删除。
- 删除后全量跑 build + test 确认无引用残留。

## 兼容与回滚

- 所有新事件类型对旧 reducer 是未知事件 → reducer default 分支已返回原状态，安全。
- models.json 新字段可选，旧配置照常工作；回滚 = 还原字段即可，无迁移。
- R5 标题生成完全前端侧，失败静默；回滚仅需移除触发点。
- 每项独立成 commit，可单独 revert。

## 风险

- R2 双层重试（SDK maxRetries=3 + 外层 retryAssistantCall）最坏情况 4×4 次请求。缓解：外层 retry 只在异常路径触发，SDK 层通常已吸收瞬态错误；如实测重试风暴，将 SDK 层降回 0、只留外层。
- R1 分类靠正则匹配错误文本，依赖 pi-ai 错误措辞。缓解：分类函数集中一处 + 测试锚定当前措辞；未匹配走兜底文案，不会更差。
- R5 额外一次 LLM 调用产生少量费用；maxTokens=64 控制成本。