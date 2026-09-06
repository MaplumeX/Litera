# PRD: Chat quick model switcher

## Background

litera 的内嵌 agent runtime 聊天界面目前切换模型需要：齿轮 → AgentConfigDialog（完整表单）→ 选 provider → 选 model，路径深、表单重，不适合运行中快速换模型。业界通行做法（ChatGPT / Claude / Neon UI / assistant-ui 等）是把模型选择器放在聊天表面上（输入框旁或 header），点击弹出轻量 popover，一键切换。

底层能力已具备：
- `switch_provider(providerId, model)` Tauri 命令已存在（`src-tauri/src/agent_config.rs`）
- runtime 支持会话中途换模型，并在时间线落 `model_change` 条目
- `ChatInput` 底部已有 thinking level 的 `Select`，样式可复用
- `listRemoteModels` 可拉取 provider 的远端模型列表

## Requirements

1. 聊天输入区显示当前模型 chip，常驻可见（显示当前 `configSnapshot.model`）
2. 点击 chip 弹出轻量 popover：
   - 按来源分组列出可选模型（当前 provider 的内置 catalog 模型 + 自定义 provider 的 models 列表）
   - 当前选中模型带勾选标记
3. 选中即调 `switch_provider`，无需打开配置对话框
4. 未配置（`configured: false`）时 chip 引导用户打开 AgentConfigDialog
5. streaming 期间禁用切换（与 thinking level 一致）
6. i18n：en + zh-CN
7. 齿轮入口保留，仍承载 API key / 自定义 provider 等完整配置

## Decisions

1. 位置：**输入框旁**（与 thinking level 选择器同排），样式沿用现有 `Select` 的轻量形态
2. 跨 provider 切换：**本次不做**，popover 仅列当前 provider 的模型；provider 切换仍走配置对话框

## Out of scope

- `/model xxx` 斜杠命令（可后续加）
- 跨 provider 一键切换的完整 picker（provider 切换仍走配置对话框）

## Acceptance criteria

- [ ] 聊天输入区可见当前模型名，点击可弹出模型列表
- [ ] 选择模型后配置即时生效（`switch_provider` 被调用），下一条消息使用新模型
- [ ] 会话中途切换在时间线产生 `model_change` 条目（runtime 已有行为，不回归）
- [ ] streaming 时切换入口禁用
- [ ] 未配置 agent 时 chip 引导至配置对话框
- [ ] en / zh-CN 文案齐全
- [ ] 新增组件有测试；ChatPanel / ChatInput 现有测试不回归
