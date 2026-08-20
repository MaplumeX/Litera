# 将思考强度从会话级移到输入框附近(全局级)

## Goal

把 LLM 思考强度(thinking level)从「会话级持久属性、藏在会话设置弹窗里」改为「全局级持久设置、入口在聊天输入框附近」，交互对齐 ChatGPT/Claude 的即时切换体验。

## Background

- 现状：`thinkingLevel` 与 `systemPrompt` 一起存在 Pi session 的 `session_config` entry 中，是会话级属性。
- UI 入口是 `SessionConfigDialog`（点击聊天头部齿轮 → 弹窗），摩擦大、不鼓励频繁切换。
- Rust `settings.json` 已经写入 `defaultThinkingLevel`（`save_agent_config` 里硬编码 `"medium"`），但前端从未读取，属于半成品。
- `ensureAgent` 在每次构建 Agent 时从 `sessionConfig(session)` 取 thinkingLevel 并 `clampThinkingLevel`。

## Requirements

### R1 思考强度变为全局设置
- 思考强度的唯一来源是全局 agent 设置（`settings.json` 的 `defaultThinkingLevel`），不再随会话存储。
- 切换会话不影响当前思考强度；切换模型/提供商时，该设置保持不变（由 `clampThinkingLevel` 在运行时安全降级）。

### R2 入口移到输入框附近
- 在 `ChatInput` 工具栏（input hint 那一行）放一个思考强度下拉/按钮组，点击即切、即时生效，无需打开弹窗、无需点保存。
- 档位沿用现有 7 档：off / minimal / low / medium / high / xhigh / max。
- 流式输出中(isStreaming)禁用切换，与现有 SessionConfigDialog 行为一致。

### R3 从会话设置弹窗移除
- `SessionConfigDialog` 移除思考强度字段，只保留 systemPrompt。
- `SessionConfigDialog` 的 `onSave` 签名去掉 thinkingLevel 参数。
- 会话列表项(`AgentSessionSummary`)不再携带 thinkingLevel。

### R4 全局设置写入与读取
- Rust 侧新增（或复用）能力：读取 `defaultThinkingLevel`、单独写入它（不附带 provider/model/apiKey 一起保存）。
- `AgentConfigSnapshot` 暴露当前 `thinkingLevel`，前端 `useAgentConfig` 可读。
- 前端切换思考强度 → 调用 Rust 写入 → `embeddedAgentRuntime.invalidateConfig()` 让下次 prompt 重建 Agent 时生效。

### R5 旧会话数据兼容
- 旧 session_config entry 里的 `thinkingLevel` 字段在读取时被忽略（不再作为来源）。
- 不做数据迁移、不删旧字段；`sessionConfig()` 返回的 thinkingLevel 不再被消费。

### R6 i18n
- 输入框旁的控件文案复用现有 `chat.thinkingLevel` key；档位标签沿用现有展示。
- 会话设置弹窗描述文案 `chat.sessionConfigDescription` 调整为只提 systemPrompt。

## Acceptance Criteria

- [ ] AC1 在 ChatInput 工具栏可见思考强度控件，点击可在 7 档间切换，切换后立即持久化（重开应用仍是新值）。
- [ ] AC2 SessionConfigDialog 不再出现思考强度字段；只保留 systemPrompt。
- [ ] AC3 切换会话、新建会话、删除会话后，思考强度控件显示的值不变（全局唯一）。
- [ ] AC4 流式输出中思考强度控件禁用；结束后可再次切换。
- [ ] AC5 旧会话（session_config 含 thinkingLevel）打开后不报错，其 thinkingLevel 被忽略，控件显示全局值。
- [ ] AC6 `AgentSessionSummary` / `PiSessionSummary` 不再包含 thinkingLevel 字段；相关测试更新。
- [ ] AC7 前后端相关单测通过；`pnpm test` 与 `cargo test` 对应模块绿。

## Out of Scope

- 不改 systemPrompt 的存储方式（仍是会话级）。
- 不改模型/提供商选择 UI。
- 不引入「每条消息临时覆盖思考强度」的能力（持久全局值即足够）。
- 不做旧 session_config 数据删除/迁移。