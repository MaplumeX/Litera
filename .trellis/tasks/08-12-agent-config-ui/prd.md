# Agent config settings UI (child 2 of decouple-agent-config)

## Goal

在 Litera 前端提供设置入口,让用户配置 LLM provider / API key / 默认 model,持久化到 child 1 定义的独立 agent 配置目录,使 sidecar 的 `DefaultResourceLoader` 能直接读取。

## Parent

`08-12-decouple-agent-config`。本 child 负责 R3,依赖 child 1 已完成的协议与目录契约。

## Depends on

`08-12-agent-dir-protocol` 必须先完成:
- sidecar 已从 `<app_data_dir>/agent/` 读取 `auth.json`/`settings.json`。
- 协议契约稳定(child 1 定义 `agentDir` 路径来源)。

## Requirements

### R3 配置 UI 与持久化
- 在 Litera 前端新增"设置"入口(位置见 design,建议放在阅读视图的头部菜单或独立设置面板)。
- UI 提供:
  - **Provider 选择**:从 pi 内置 provider catalog 列表中选择(通过新的 Tauri command 从 sidecar/Rust 获取可用 provider 列表;首版至少支持 api_key 类型 provider)。
  - **API Key 输入**:对应所选 provider 的 API key,密码类型输入框。
  - **默认 Model 选择**:基于所选 provider 的可用 model 列表(同样通过 Tauri command 获取)。
- 保存时通过 Tauri command 写入:
  - `<app_data_dir>/agent/auth.json`:`{ "<providerId>": { "type": "api_key", "key": "<key>" } }`(保留已有其他 provider 条目,合并写入)。
  - `<app_data_dir>/agent/settings.json`:更新 `defaultProvider`、`defaultModel`、`defaultThinkingLevel`(保留其他字段,合并写入)。
- 文件格式与 pi-coding-agent 兼容,sidecar 无需改动即可读取(child 1 已保证)。

### 配置状态可见
- UI 应反映当前已配置的 provider/model(打开设置时回读 auth.json/settings.json)。
- 未配置时,agent 聊天界面给出明确提示(如"未配置 LLM provider,请前往设置"),而非崩溃或静默失败。
- 配置变更后,已打开的 sidecar 会话无需重启即可生效(`DefaultResourceLoader.reload()` 在下次创建 session 时读取新配置;需在 design 中确认是否需要 sidecar 主动 reload 或重启 sidecar)。

### 配置入口的 Tauri command
- 新增 Rust command(如 `get_agent_config`、`save_agent_config`、`list_providers`、`list_models`)封装配置读写与 provider/model 列表查询。
- provider/model 列表来源:pi 内置 catalog(通过 sidecar 或直接调 pi SDK 获取——design 决定路径)。

## Constraints

- 配置文件写入路径必须是 child 1 定义 的 `<app_data_dir>/agent/`,不得硬编码其他路径。
- 写入 auth.json 时不得覆盖已有其他 provider 条目(合并语义)。
- API key 不得明文记录到日志或 journal。
- UI 风格与现有 Litera UI 一致(见 `.trellis/spec/frontend`)。
- 首版仅支持 api_key 类型 provider;oauth 类型 UI 留待后续(父任务 out of scope)。

## Acceptance Criteria

- [ ] Litera 设置 UI 能展示 provider 列表(来自 pi 内置 catalog)、model 列表(基于所选 provider)。
- [ ] 用户填写 provider / API key / model 并保存后,`<app_data_dir>/agent/auth.json` 与 `settings.json` 被正确写入,格式与 pi 兼容。
- [ ] 重新打开设置 UI,能回读并显示当前已配置的 provider/model(API key 可用掩码显示)。
- [ ] 未配置 provider 时,在阅读界面发送 prompt 给出明确"未配置,请前往设置"提示,sidecar 不崩溃。
- [ ] 配置完成后(无需重启 Litera),打开一本书发送 prompt 能正常流式返回。
- [ ] 保存配置时保留 auth.json 中已有其他 provider 条目(合并而非覆盖)。
- [ ] 删除/重命名 `~/.pi/agent` 后,通过 UI 配置并使用 agent 全流程正常。
- [ ] API key 不出现在任何日志/journal/控制台输出中。

## Out of Scope

- OAuth provider 配置 UI。
- `models.json` 自定义模型目录 UI。
- 从本机 pi 一键导入。
- 多 provider 复杂管理 UI(首版单 provider 配置即可,auth.json 结构本身支持多 provider)。

## Notes

- provider/model 列表来源已确认:pi 有 `builtinProviderCatalog.builtinProviders()`,即使无 `models.json` 也能列出。design 需确定是通过 sidecar 暴露还是 Rust 直接调 pi SDK 获取。
- `defaultThinkingLevel` 可暂用合理默认(如 "medium"),UI 是否暴露该选项见 design。