# 支持自定义 OpenAI 兼容供应商

## Goal

允许用户添加多个自定义 OpenAI 兼容端点（如 Ollama、vLLM、第三方中转），每个端点有独立的名称、baseUrl、apiKey 和 model，可在 LLM 设置中选用。

## Background

- 当前 `src/types/agent-config.ts` 硬编码 10 个内置供应商，`AgentConfigDialog` 用固定下拉框选择
- `src-tauri/src/agent_config.rs` 只写 `auth.json` + `settings.json`，**不写 `models.json`**
- pi-coding-agent 通过 `<agentDir>/models.json` 加载自定义供应商（`api: "openai-completions"` 适用于 OpenAI 兼容端点），apiKey 从 `auth.json[<providerId>]` 读取
- sidecar 当前只把 `agentDir` 透传给 pi，不感知供应商细节 —— 无需改动

## Requirements

### 功能需求

- 用户可添加多个自定义供应商，每条包含：显示名称、baseUrl、apiKey、model id
- 用户可删除已添加的自定义供应商
- 用户可切换"内置供应商"与"自定义供应商"；选中自定义供应商后成为当前激活的 LLM
- 自定义供应商与内置供应商共用同一套 apiKey/model 保存与读取路径（auth.json / settings.json）
- 保存自定义供应商后需重启 sidecar 使 pi 重新加载 models.json

### 数据模型

- 新建 `<agentDir>/models.json`，结构：`{ "providers": { "<customId>": { "baseUrl": "...", "api": "openai-completions", "models": [{ "id": "<modelId>" }] } } }`
  - provider 条目**不含** `apiKey` 字段（apiKey 走 auth.json）
  - `customId` 由 Rust 生成，统一 `custom-` 前缀避免与内置 id 冲突
- `auth.json` 按现有格式存自定义供应商 key：`{ "<customId>": { "type": "api_key", "key": "..." } }`
- `settings.json` 的 `defaultProvider` / `defaultModel` 在切换到自定义供应商时设为 `customId` / model id
- 删除自定义供应商时：从 models.json 移除条目、从 auth.json 移除 key 条目；若被删除的是当前激活供应商，回退到未配置状态

### 约束

- `api` 固定为 `openai-completions`，不暴露给用户
- models.json 读写由 Rust 统管（atomic_write），sidecar 不感知
- 自定义供应商数量无硬上限，但 UI 需可滚动
- 现有内置供应商流程不得回归

## Acceptance Criteria

- [ ] 用户可在设置对话框添加自定义供应商（name + baseUrl + apiKey + model），保存后重启 sidecar 生效
- [ ] 用户可删除自定义供应商；删除当前激活供应商后 `get_agent_config` 反映未配置状态
- [ ] 切换到自定义供应商后，agent 对话能正常发起（pi 通过 models.json + auth.json 解析）
- [ ] `models.json` 由 Rust 原子写入，无残留 temp 文件
- [ ] 删除自定义供应商时 models.json 与 auth.json 同步清理，不残留孤儿条目
- [ ] `cargo test`、`tsc`、`vite build` 全部通过
- [ ] 现有内置供应商配置流程无回归（既有测试通过）

## Notes

- 本任务涉及前端 UI（AgentConfigDialog 重构）、Rust 后端（agent_config.rs 扩展 + 新增 models.json 读写）、类型层（agent-config.ts）
- sidecar / protocol 无需改动
- 轻量任务判定：虽跨三层，但改动集中在配置流且无独立可验证的子交付物，按单任务推进