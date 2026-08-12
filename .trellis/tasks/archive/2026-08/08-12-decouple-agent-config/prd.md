# Decouple sidecar from host pi agent config

## Goal

Litera 的 sidecar 目前复用本机 pi 的配置目录(`~/.pi/agent`)来加载 LLM provider、auth、models。本任务要让 Litera 拥有完全独立的 agent 配置目录,并在 UI 上提供配置入口,使用户无需依赖本机 pi 即可在 Litera 内配置 provider / API key / model。

## Background

当前链路:
- `sidecar/index.ts` 中 `makeResourceLoader()` 硬编码 `agentDir: ${process.env.HOME}/.pi/agent`。
- Rust 侧 `notify_book_opened` 已用 `app_data_dir()` 拿到 Litera 自己的数据目录(用于 sessions),但未把任何 agent 配置路径传给 sidecar。
- sidecar 由 Tauri `shell().sidecar("litera-sidecar")` spawn,无环境变量注入。
- pi 的 `DefaultResourceLoader` 用 `agentDir` 读取 `auth.json`(provider 凭据)、`settings.json`(`defaultProvider`/`defaultModel`/`defaultThinkingLevel` 等)、`models.json`(模型目录)。

pi 配置文件格式(供 Litera 复用同一套读取逻辑):
- `auth.json`: `{ "<providerId>": { "type": "api_key", "key": "..." } }`(也支持 oauth,本任务首版只覆盖 api_key 类型)。
- `settings.json`: 关键字段 `defaultProvider`、`defaultModel`、`defaultThinkingLevel`;其余 UI/packages 字段 Litera 不需要。
- `models.json`: 模型目录,首版可由 pi 内置 catalog 提供,Litera 不强制自定义。

## Requirements

### R1 独立配置目录
- Litera 的 agent 配置目录位于 `<app_data_dir>/agent/`(与现有 `<app_data_dir>/sessions/` 同级),sidecar 必须只从该目录读取 provider/auth/models,不再读取 `~/.pi/agent`。
- 目录在首次需要时自动创建。
- 现有 `~/.pi/agent` 目录保持不变,不受 Litera 影响。

### R2 配置目录传递(协议命令方式)
- Rust 在 sidecar 启动后、发 `open_book` 之前,通过新的 `configure` 命令把 agent 配置目录路径传给 sidecar。
- sidecar 收到 `configure` 后,用它构造 `DefaultResourceLoader`,在收到 `open_book` 前若未配置则使用安全默认(空目录,后续由 UI 写入配置)。
- 协议变更需同步更新 `sidecar/protocol.ts` 与 `src-tauri/src/sidecar_protocol.rs`,并保持 `AGENT_PROTOCOL_VERSION` 兼容性策略。

### R3 配置 UI(选项 A)
- 在 Litera 前端新增设置入口,允许用户配置:
  - Provider(从 pi 支持的 provider 列表中选择,首版至少支持 api_key 类型 provider)
  - API Key(对应所选 provider)
  - 默认 Model
- 配置通过 Tauri command 持久化到 `<app_data_dir>/agent/auth.json` 与 `settings.json`,格式与 pi 兼容,使 sidecar 的 `DefaultResourceLoader` 能直接读取。
- 未配置时,agent 功能应给出明确提示(如"未配置 LLM provider,请前往设置"),而不是崩溃或静默失败。

### R4 隔离与回滚
- 不改动现有 `~/.pi/agent` 任何内容。
- sidecar 的 `systemPromptOverride`、`noExtensions/noSkills/...` 等阅读助手设定保持不变。
- 现有 sessions 目录布局不变。

## Constraints

- 复用 pi-coding-agent SDK 的配置文件格式,不自造配置格式。
- sidecar 打包产物(`dist/litera-sidecar.cjs`)与 Rust 协议需保持一致,版本号变更需双向同步。
- 前端配置 UI 风格需与现有 Litera UI 一致。
- 不引入对 `~/.pi/agent` 的任何运行时读取。

## Acceptance Criteria

- [ ] sidecar 启动后从 Rust 传入的 `configure` 命令获取 agent 配置目录,且不再读取 `~/.pi/agent`。
- [ ] `<app_data_dir>/agent/` 目录在未配置时为空或仅含默认文件,sidecar 不报启动错误。
- [ ] 用户可在 Litera 设置 UI 中填写 provider / API key / model,保存后写入 `<app_data_dir>/agent/auth.json` 与 `settings.json`。
- [ ] 配置完成后,打开一本书并发送 prompt 能正常流式返回(工具调用、文本均正常)。
- [ ] 未配置 provider 时,发送 prompt 给出明确"未配置"提示而非崩溃。
- [ ] 全程不触碰 `~/.pi/agent` 目录(可通过删除/重命名该目录验证 Litera 仍正常工作)。
- [ ] 现有 session 列表、切换、删除、新书加载等非配置功能不受影响。
- [ ] sidecar 协议测试与 Rust 协议测试通过;新增 configure 命令的编解码测试通过。

## Out of Scope

- OAuth 类型 provider 的 UI 配置流程(首版仅 api_key;oauth 留待后续)。
- `models.json` 的自定义模型目录 UI(沿用 pi 内置 catalog)。
- 从本机 pi 配置一键导入的功能。
- 多 provider 同时管理的复杂 UI(首版聚焦单 provider 配置即可,但 auth.json 结构支持多 provider)。

## Task Map (parent owns requirements + integration review)

本 parent 不直接实现,交付物由两个可独立验证的 child 承担:

- **child 1 — `08-12-agent-dir-protocol`**:sidecar 协议新增 `configure` 命令 + Rust 传递 agentDir + sidecar 改用传入目录。基础设施层,无需 UI 即可验证(手动放配置文件跑 sidecar)。
- **child 2 — `08-12-agent-config-ui`**:前端设置 UI + Tauri command 持久化 auth/settings。前端特性层,可先实现写文件再联调 sidecar 读取。

执行顺序:child 1 先行(它定义协议与目录契约),child 2 在 child 1 完成后联调。两个 child 各自独立验收;parent 在两者完成后做集成验收(端到端:UI 配置 → 写文件 → sidecar 读取 → 流式对话成功)。

## Notes

- parent 自身只需 `prd.md`(本文件);复杂任务的 design.md / implement.md 下沉到各 child。
- 跨 child 的集成验收标准即上方 Acceptance Criteria 中的端到端项。