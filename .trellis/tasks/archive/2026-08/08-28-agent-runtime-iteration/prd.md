# Agent runtime iteration: reliability, model config, UX events, cleanup

## Goal

迭代 Litera 内嵌 agent runtime（`src/agent/`）的可靠性、可配置性与可观测性，并清理死代码。本轮不做新工具（create_highlight、阅读位置感知不在范围内）。

## Scope（用户选定项）

来源：2026-08-28 与用户的迭代盘点。用户选定解决以下 7 项中的 **1、2、3、5、7、9**（原文编号）：

1. **错误信息区分**：prompt 失败不再统一显示「模型请求失败」，按 HTTP 状态/错误类型给出可区分的提示（401 key 无效 / 429 限流 / 网络失败等）。
2. **重试机制**：对幂等安全的错误（429、5xx、网络错误）做 3 次指数退避重试（500ms 基数 + 抖动，流式首字节前才可重试）。
3. **自定义模型窗口自动解析**（方案 A）：`custom-*` 模型按「pi-ai 内置目录优先 → `/models` 探测（OpenRouter `context_length` / vLLM `max_model_len`）→ 默认 128k/8192 兑底」三层解析，大多数用户零配置，无手动填写 UI。
5. **会话标题自动生成**：第一轮对话结束后用小请求生成标题（替代/优于当前截断首条消息的 fallback）。
7. **UI 事件粒度**：透传 thinking delta 事件，UI 展示「思考中」可折叠区域；usage/cost 不显示不透传（用户决策）。
9. **死代码清理**：`src/agent/runtime/pi-spike.ts`（及其测试）与 `src/agent/sessions/pi-session.ts` 的 `windowCompleteTurns`（无调用方）。

未选（明确不做）：4（新工具/阅读位置）、6（压缩配置 UI 与压缩 prompt 定制）、8（per-session 模型/thinkingLevel 配置）、10（prompt 排队）、11（搜索扩展）。

## Confirmed Facts（代码勘察）

- `src/agent/runtime/embedded-runtime.ts` `prompt()` 的 catch 块将所有异常替换为「模型请求失败，请检查配置后重试」；`ensureAgent` 中 `maxRetries:0` 写死。
- `src/agent/transport/native-fetch.ts` 为安全已抹平原生错误（不回显），错误区分需在 runtime 层基于结构化信息实现，且不得泄漏 headers/URL/凭据。
- `src/agent/runtime/model-resolution.ts`：custom 分支不再直接返回硬编码模型，而是先按模型 id 查 pi-ai 全目录（含 DeepSeek/GLM/Kimi 等），命中即复用其 contextWindow/maxTokens 与 compat 配置
- 会话标题 fallback 在 `src-tauri/src/pi_sessions.rs` `first_user_text`（截断 80 字符）。
- `embedded-runtime.ts` `onPiEvent` 只转发 `text_delta`、`tool_execution_start/end`；Pi 事件流中还含 thinking delta、usage、cost。
- `src/agent/runtime/pi-spike.ts` + `pi-spike.test.ts` 为 spike 遗留；`windowCompleteTurns` 导出无调用方（仅定义处）。

## Requirements

### R1 错误信息区分（embedded-runtime）
- prompt 失败时按错误类型给出可区分的用户提示：鉴权失败（401/403）、限流/配额（429）、服务端错误（5xx）、网络失败、上下文超限（已有 `isContextOverflow`）、其他。
- 不得回显原始 fetch 错误文本（延续 native-fetch 的安全约束：不泄漏 headers/URL/凭据）。
- 错误信息通过现有 `error` 事件传递，UI 直接展示 runtime 给出的文案。

### R2 请求重试（embedded-runtime）
- 对可重试错误（429、5xx、网络失败）做有限次指数退避重试；确定性错误（401/403、上下文超限、参数错误）立即失败不重试。
- 策略（用户确认 2026-08-28）：3 次重试、500ms 基数指数退避 + 抖动；流式请求在首个字节到达前的失败才重试。
- 复用 pi-ai 现成的 `retryAssistantCall` + `isRetryableAssistantError`（`@earendil-works/pi-ai` 导出），而不是手写重试循环。
- 重试期间通过事件告知 UI（如 retry_scheduled），避免用户以为卡死。

### R3 自定义模型窗口自动解析（方案 A）
- `resolveRuntimeModel` 对 `custom-*` provider 按三层解析 contextWindow / maxTokens：
  1. **pi-ai 内置目录优先**：按模型 id 在 pi-ai 全 provider 目录中查找（如 `deepseek-v4-pro` → 1M/384k），命中直接用内置值——大多数用户零配置。
  2. **`/models` 探测**：未命中时拉取 `{baseUrl}/models`（复用现有 `list_remote_models` 路径），解析 OpenRouter 的 `context_length` 与 vLLM 的 `max_model_len` 字段；maxTokens 无可靠探测源，取 contextWindow 的固定比例（如 1/8）。
  3. **默认值兑底**：前两层都未命中 → 维持现状 128_000/8_192（宁可早压缩不可超限）。
- 探测失败（网络/鉴权/无字段）完全无害，静默落到下一层，不增加失败路径。
- 不做用户手动填写 UI（用户明确不需要）；不做溢出自适应 compaction 重试（方案 A 明确排除）。

### R5 会话标题自动生成
- 第一轮对话正常结束后，用一次小请求（小 maxTokens）生成简短标题，写入 session_info。
- 失败（网络/限流/用户已改名）时静默降级为现有 `first_user_text` 截断 fallback，不影响会话可用性。
- 不打断正在进行的对话流。

### R7 UI 事件粒度
- thinking delta：透传 `thinking_start/delta/end` 事件，UI 展示「思考中」可折叠区域。
- usage/cost 不展示、不透传（用户决策 2026-08-28）：不做 token 用量显示，也不做上下文用量条。
- 事件通过现有 `AgentEvent` 通道扩展新事件类型，不改变既有事件的语义。

### R9 死代码清理
- 删除 `src/agent/runtime/pi-spike.ts` 与 `pi-spike.test.ts`。
- 删除 `src/agent/sessions/pi-session.ts` 的 `windowCompleteTurns`（无调用方，相关测试一并删除）。

## Acceptance Criteria

- [ ] AC1 模拟 401/429/网络错误时，UI 错误提示能区分出鉴权失败、限流、网络失败三类；提示文案不含 URL、headers 或 key。
- [ ] AC2 模拟 429 后成功：请求自动重试且最终成功，UI 有重试提示；模拟 401：不重试直接失败。
- [ ] AC3 `custom-*` 模型：pi-ai 目录命中（如 deepseek-v4-pro）时解析出 1M 窗口；目录未命中但 `/models` 返回 `context_length` 时采用探测值；两者都不可用时回落 128k/8192；探测失败不影响 prompt 流程。
- [ ] AC4 新会话完成第一轮对话后标题自动生成；标题请求失败时回落为截断 fallback；用户已手动改名则不覆盖。
- [ ] AC5 思考模型输出时 UI 显示可折叠「思考中」区域；usage/cost 不在任何 UI 中显示。
- [ ] AC6 `pi-spike.ts`、`windowCompleteTurns` 及其测试删除后，`npm run build`、`npm test`（或项目等效命令）全部通过。

## Resolved Decisions

- R7：usage/cost 不显示、不透传（仅 thinking 透传）。
- R2：3 次重试、500ms 基数指数退避 + 抖动，流式首字节前才可重试。
- R3：方案 A（pi-ai 目录优先 → `/models` 探测 → 默认 128k/8192 兑底），不做手动填写 UI、不做溢出自适应（用户选定 2026-08-28）。