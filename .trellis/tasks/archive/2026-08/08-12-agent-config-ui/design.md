# Design — Agent config settings UI (child 2)

## Scope

在 Litera 前端新增设置入口,让用户配置 LLM provider / API key / 默认 model,持久化到 child 1 定义的 `<app_data_dir>/agent/` 目录。Rust 侧做纯文件读写,不依赖 sidecar 协议。

## 现状

- 前端无设置入口;所有配置依赖本机 pi(已由 child 1 解耦到独立目录,但目录尚无内容)。
- pi 的 `auth.json` 格式:`{ "<providerId>": { "type": "api_key", "key": "..." } }`。
- pi 的 `settings.json` 关键字段:`defaultProvider`、`defaultModel`、`defaultThinkingLevel`。
- pi-ai 内置 provider catalog 有 ~38 个 provider,每个有若干 model。但这些数据只在 sidecar(Node)进程内可用,Rust/前端不直接依赖 pi-ai。

## 设计决策

### D1 provider/model 列表来源 — 前端硬编码 + 手填 model

首版采用最简方案:
- **Provider 列表**:前端硬编码常用 api_key 类型 provider(从 pi-ai catalog 提取 id 与显示名),如 anthropic / openai / deepseek / google / openrouter / groq / mistral / xai / together / fireworks。覆盖大多数用户。不依赖 sidecar 暴露。
- **Model**:用户手填 model id(文本输入),因为每个 provider 的 model 列表很长且会更新,首版不提供下拉。placeholder 给出该 provider 的示例 model(如 anthropic → `claude-opus-4-5`)。
- **Thinking level**:固定为 `medium`,不暴露 UI(减少首版范围)。

理由:避免 sidecar 协议再扩展(独立于 child 1 的协议),Rust 只做纯文件读写,child 2 可完全独立实现与验证。后续可升级为 sidecar 暴露 list_providers/list_models。

### D2 配置存储 — Rust 纯文件操作

新增 Rust command `save_agent_config` / `get_agent_config`,操作 `<app_data_dir>/agent/` 下的 `auth.json` 与 `settings.json`:
- `get_agent_config` → 读取现有 auth.json / settings.json(不存在则返回空结构),返回 `{ provider, apiKeyMasked, model, configured }`。
- `save_agent_config(provider, apiKey, model)` → 合并写入:
  - `auth.json`:读现有内容(不存在则 `{}`),设置 `auth[provider] = { type: "api_key", key: apiKey }`,保留其他 provider 条目,写回。
  - `settings.json`:读现有内容(不存在则 `{}`),设置 `defaultProvider = provider`、`defaultModel = model`、`defaultThinkingLevel = "medium"`,保留其他字段,写回。
- 写入用原子写(临时文件 + rename),与 library.json 一致。
- API key 不写入日志。

### D3 配置生效 — 重启 sidecar

配置变更后,已运行的 sidecar 仍持有旧 `DefaultResourceLoader`(在已创建的 session 内)。新 session 会重新 `makeResourceLoader()` 读取新配置。但 `modelRuntime` 在 `createAgentSession` 时构造一次,session 存续期间不会重读 auth。

首版策略:配置保存成功后,前端提示用户"配置将在下次打开书时生效"或主动调 `restart_sidecar`(已有 command)。**采用 restart_sidecar** —— 最简单且保证立即生效。保存后自动调 `restart_sidecar`,sidecar 重启后 Ready → configure → 后续 session 用新配置。

### D4 UI 结构

设置入口:在阅读视图的工具栏(ReaderControls 区域)加一个"设置"按钮(齿轮图标),点击弹出设置面板(modal 或 sidebar,沿用现有 UI 模式)。

设置面板内容:
- Provider 下拉(硬编码列表)
- API Key 密码输入框(已配置时显示掩码占位,聚焦清空)
- Model 文本输入(placeholder 随 provider 变化)
- 保存按钮 / 取消按钮
- 保存成功提示

未配置时的提示:ChatPanel 在 `state.error?.message` 包含"Agent directory not configured"或类似时,显示"请前往设置配置 LLM provider"提示 + 跳转按钮。但更简单的方式:ChatPanel 初始化时调 `get_agent_config`,若 `configured=false` 则显示配置提示。

### D5 Rust command 定义

```rust
#[tauri::command]
pub async fn get_agent_config(app: AppHandle) -> AppResult<AgentConfigSnapshot>

#[tauri::command]
pub async fn save_agent_config(app: AppHandle, provider: String, api_key: String, model: String) -> AppResult<()>
```

```rust
#[derive(Serialize)]
pub struct AgentConfigSnapshot {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub has_api_key: bool,
}
```
不返回 API key 明文,只返回 `has_api_key`(掩码)。

放在 `src-tauri/src/agent_config.rs` 新模块(与 library.rs 平级),注册到 lib.rs invoke_handler。

## 变更清单

### src-tauri/src/agent_config.rs (新文件)
- `get_agent_config(app)` → 读 `<app_data_dir>/agent/auth.json` + `settings.json`,返回 snapshot。
- `save_agent_config(app, provider, api_key, model)` → 合并写入 auth.json + settings.json(原子写)。
- 读取/写入用 serde_json,文件不存在时返回空对象。
- 原子写:写临时文件 `auth.json.tmp` → rename。与 library.rs 的写入模式一致。

### src-tauri/src/lib.rs
- `mod agent_config;`
- invoke_handler 注册 `agent_config::get_agent_config`、`agent_config::save_agent_config`。

### src/types/agent-config.ts (新文件)
- `AgentConfigSnapshot` 类型 + provider 列表常量 + 示例 model 映射。

### src/lib/use-agent-config.ts (新文件)
- `useAgentConfig` hook:调 `get_agent_config` 加载当前配置,`save_agent_config` 保存,`restart_sidecar` 重启。

### src/components/AgentConfigDialog.tsx (新文件)
- 设置面板 UI:provider 下拉 + API key 输入 + model 输入 + 保存/取消。

### src/components/ChatPanel.tsx
- 未配置时显示"请前往设置配置 LLM provider"提示 + 打开设置按钮。

### src/components/ReaderControls.tsx (或 App.tsx)
- 添加"设置"按钮,打开 AgentConfigDialog。

## 数据流

```
用户打开设置 → AgentConfigDialog
  → useAgentConfig.load() → invoke get_agent_config → Rust 读 auth.json/settings.json
  → 显示当前 provider/model/has_api_key
用户填写 + 保存
  → invoke save_agent_config(provider, apiKey, model)
  → Rust 原子写 auth.json + settings.json 到 <app_data_dir>/agent/
  → invoke restart_sidecar → sidecar 重启 → Ready → configure → 新 session 用新配置
  → 提示保存成功
```

## 兼容性与回滚

- 纯新增文件 + 少量改动,不触碰 child 1 的协议/sidecar 代码。
- 回滚 = `git checkout` 新增文件 + lib.rs 注册行。
- 已写入的 auth.json/settings.json 可保留(格式与 pi 兼容,不影响其他)。

## 风险

- **R1(restart_sidecar 时序)**:保存配置后立即 restart_sidecar,sidecar 重启期间用户若正在对话会被中断。首版可接受(配置是低频操作);UI 应在重启期间显示状态。
- **R2(provider 列表过时)**:硬编码列表可能漏掉新 provider。首版覆盖主流,后续可升级为动态获取。
- **R3(并发写)**:save_agent_config 与 sidecar 读取可能并发。原子写(rename)保证 sidecar 读到的是完整文件;sidecar 在 createSession 时一次性读入,不会读到半写状态。

## Out of Scope

- 动态 provider/model 列表(依赖 sidecar 暴露)。
- OAuth provider UI。
- 多 provider 管理 UI。
- thinking level UI。