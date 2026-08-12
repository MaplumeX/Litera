# Implement — Agent config settings UI (child 2)

执行顺序自下而上:Rust command → 前端类型/hook → UI 组件 → 集成。

## Step 1 — Rust:agent_config 模块

### 1a src-tauri/src/agent_config.rs (新文件)
- [ ] 定义 `AgentConfigSnapshot` struct(Serialize,camelCase):`{ configured: bool, provider: Option<String>, model: Option<String>, has_api_key: bool }`。
- [ ] `get_agent_config(app: AppHandle) -> AppResult<AgentConfigSnapshot>`:
  - 解析 `app.path().app_data_dir().join("agent")`。
  - 读 `auth.json`(不存在→`{}`),读 `settings.json`(不存在→`{}`)。
  - `provider` = settings.defaultProvider,`model` = settings.defaultModel,`has_api_key` = auth[provider].type == "api_key" && key 非空。
  - `configured` = provider 与 model 均有值且 has_api_key。
- [ ] `save_agent_config(app, provider, api_key, model) -> AppResult<()>`:
  - 读现有 auth.json(不存在→`{}`),设 `auth[provider] = { type: "api_key", key: api_key }`,保留其他条目。
  - 读现有 settings.json(不存在→`{}`),设 `defaultProvider`、`defaultModel`、`defaultThinkingLevel: "medium"`,保留其他字段。
  - 原子写:写 `auth.json.tmp` → rename `auth.json`;同理 settings.json。
  - 不记录 api_key 到日志。

### 1b src-tauri/src/lib.rs
- [ ] `mod agent_config;`
- [ ] invoke_handler 注册 `agent_config::get_agent_config`、`agent_config::save_agent_config`。

**Validation**:
```bash
cd src-tauri && cargo build 2>&1 | tail -20
cd src-tauri && cargo test 2>&1 | tail -20
```

## Step 2 — 前端类型 + 常量

### 2a src/types/agent-config.ts (新文件)
- [ ] `AgentConfigSnapshot` 接口:`{ configured: boolean; provider: string | null; model: string | null; hasApiKey: boolean }`。
- [ ] `AGENT_PROVIDERS` 常量:常用 api_key provider 列表,每项 `{ id: string; label: string; exampleModel: string }`:
  - anthropic / openai / deepseek / google / openrouter / groq / mistral / xai / together / fireworks
- [ ] 导出 `findProviderExample(providerId)` 辅助函数。

**Validation**:
```bash
npm run typecheck
```

## Step 3 — 前端 hook

### 3a src/lib/use-agent-config.ts (新文件)
- [ ] `useAgentConfig` hook:
  - `load()`:invoke `get_agent_config` → setState。
  - `save(provider, apiKey, model)`:invoke `save_agent_config` → 成功后 invoke `restart_sidecar` → 重新 `load()`。
  - 暴露 `{ snapshot, load, save, saving, error }`。

**Validation**:
```bash
npm run typecheck
```

## Step 4 — UI 组件

### 4a src/components/AgentConfigDialog.tsx (新文件)
- [ ] Modal/对话框:provider 下拉(AGENT_PROVIDERS)+ API key 密码输入(placeholder "已配置,重新输入可修改")+ model 文本输入(placeholder 随 provider)+ 保存/取消按钮。
- [ ] 保存调 `useAgentConfig.save`,成功后关闭并提示。
- [ ] UI 风格沿用现有组件(Button、cn 等)。

### 4b src/components/ChatPanel.tsx
- [ ] 初始化时调 `useAgentConfig.load()`;若 `snapshot.configured === false`,显示"未配置 LLM provider"提示 + "打开设置"按钮(打开 AgentConfigDialog)。

### 4c 入口按钮
- [ ] 在 ReaderControls 或 App.tsx 工具栏添加"设置"按钮(齿轮),打开 AgentConfigDialog。

**Validation**:
```bash
npm run typecheck
npm run build 2>&1 | tail -20
```

## Step 5 — 全量验证

- [ ] `cd src-tauri && cargo test`
- [ ] `npm run typecheck && npm run build`
- [ ] 手动集成验证:
  - 启动 Litera,打开设置,填入有效 provider/api_key/model,保存。
  - 确认 `<app_data_dir>/agent/auth.json` + `settings.json` 正确写入(格式与 pi 兼容)。
  - 打开书,发送 prompt,确认流式返回。
  - 重新打开设置,确认回读 provider/model + has_api_key 掩码。
  - 删除 `~/.pi/agent`,全流程仍正常。
  - 未配置时,ChatPanel 显示"请前往设置"提示。
  - 保存配置时不覆盖 auth.json 中已有其他 provider 条目(手动放第二个 provider 验证合并)。

## Review Gate

由 `trellis-check` sub-agent 验证:
- auth.json/settings.json 合并语义(不覆盖其他条目)
- API key 不出现在日志
- 未配置时提示而非崩溃
- UI 风格一致性

## Rollback Points

- 全部新增文件 + lib.rs 注册行,回滚 = `git checkout`。
- 已写入的配置文件可保留(pi 兼容格式)。