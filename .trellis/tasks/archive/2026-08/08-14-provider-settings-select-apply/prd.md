# Align LLM provider settings with select-then-apply

## Goal

把 LLM 设置改成「先选、再保存」：下拉只改草稿，点「保存并应用」才写盘并重启 sidecar。内置和自定义共用「当前使用 + 这个提供商」表单；自定义可挂多个模型，并能从 OpenAI 兼容端点刷新模型目录。

## Background

当前 `AgentConfigForm` 把「管理提供商」和「选用当前模型」揉在同一个下拉里：

- 选中自定义会立刻 `switch_provider` + 重启 sidecar。
- 自定义主界面是只读卡片，改任何字段都要再进编辑态。
- 自定义在 `models.json` 里只读写 `models[0]`，一个端点换模型等于改提供商身份。
- 「＋ 添加自定义」是 Select 的伪选项。
- 模型 id 全部手填，Ollama / vLLM / 中转不知道该填什么。

用户选择：同一页两段表单（不做列表管理页）；只对自定义 OpenAI 兼容端点拉远端目录。

## Confirmed facts

- 配置落在 `<app_data>/agent/`：`auth.json`、`settings.json`、`models.json`。Sidecar / pi 读这三份文件，本任务不改 sidecar 协议。
- `models.json` 的 `providers.<id>.models` 已是数组；后端现在只取第一项。
- 入口有两处，共用 `AgentConfigForm`：`设置 → AI`，聊天齿轮里的 `AgentConfigDialog`。
- 内置品牌列表仍是前端硬编码（`AGENT_PROVIDERS`），模型 id 手填。
- 写盘后仍需 `restart_sidecar` 才生效。下拉变更不得重启。
- 仓库没有列模型命令。pi 对自定义端点的示例是 `GET {baseUrl}/models`，响应 `{ data: [{ id }] }`。
- API Key 不回传前端；拉取必须在 Rust 完成（WebView 直连会暴露 Key 并撞 CORS）。`Cargo.toml` 尚无 HTTP 客户端。

## Requirements

### R1 选用与写盘分离

- 提供商下拉只改表单草稿，不调用 `switch_provider` / `save_agent_config`，不重启 sidecar。
- 下拉不再包含「添加自定义」伪选项。
- 主操作只有一个「保存并应用」：把当前表单里的提供商配置写盘，并把该提供商 + 当前模型设为激活项，然后重启 sidecar。
- 关闭设置或切走 AI 分页而不点「保存并应用」，磁盘上的激活项不变。

### R2 同一页两段表单

- **当前使用**：提供商下拉 + 当前模型。内置模型为文本框；自定义模型从该提供商的模型列表选。
- **这个提供商**：随下拉选中项切换。内置只显示 API Key。自定义显示名称、Base URL、API Key、模型列表（增删，至少保留 1 个）和「刷新模型」按钮。
- 内置和自定义都不再使用「只读卡片 + 编辑态」。
- 已有 Key 时 API Key 可留空表示不变；未配置 Key 时必填。本地 Base URL 仍提示可填占位 Key。

### R3 自定义多模型

- 每个自定义提供商在 `models.json` 中保存完整 `models` 数组，不再只保留一项。
- 「当前使用」里选中的模型必须属于该列表；用户在列表里新增的模型可立即被选为当前模型。
- 不能删掉列表中的最后一个模型。
- 若删掉的是草稿里的当前模型，当前模型回退到列表中剩下的第一项。
- 已有只含一个模型的自定义提供商打开后行为不变，且可以再往列表里加。

### R4 添加与删除

- 「添加自定义提供商」是独立按钮，打开内联表单（名称 / Base URL / API Key / 模型列表，至少一个）。添加表单同样提供「刷新模型」。
- 添加成功写入该提供商的名称 / URL / Key / **当时草稿里的全部模型 id**（`models.json` + `auth.json`），**不**切换激活项，**不**重启 sidecar。下拉里出现新项，当前选中保持添加前的草稿。
- 删除自定义必须先确认（`AlertDialog`，不用 `window.confirm`）。
- 删除非激活项：只清 `models.json` + `auth.json`，不重启。
- 删除当前激活项：同时清 `settings.json` 的 `defaultProvider` / `defaultModel`，重启 sidecar，表单回到未配置（下拉回到默认内置，模型与 Key 为空）。

### R5 双入口一致

- `SettingsDialog` 的 AI 分页和 `AgentConfigDialog` 使用同一套交互。
- 聊天对话框里点「保存并应用」成功后可关闭对话框（与现有成功后关闭一致）。设置页不因保存而关设置。

### R6 自定义端点刷新模型目录

- 仅自定义 OpenAI 兼容提供商（含添加表单）显示「刷新模型」。内置提供商不拉网。
- 点击后 Rust 使用表单草稿里的 Base URL + API Key 请求 `GET {baseUrl}/models`。已保存 Key 且草稿 Key 为空时，前端必须把已保存 Key 不可得——因此刷新时前端传当前输入框中的 Key；若为空且该自定义已有 Key，前端应提示重新输入或我们改为命令可读 `auth.json`。**决定**：命令同时接受 `base_url` + `api_key`；`api_key` 为空时若传入已存在的 `provider_id`，则从 `auth.json` 读该自定义的 Key。添加表单没有 id，Key 必填。
- Key 不得出现在日志。
- 拉到的 id 合并进该提供商的模型列表草稿（去重，保留原有手加项，新 id 追加）。当前模型若仍在列表中则保持，否则改为列表第一项。
- 用户仍可手加目录里没有的 id。
- 响应为空、HTTP 失败或无法解析时显示错误，已有草稿列表不被清空。
- 刷新不写盘、不切换激活项、不重启 sidecar。点「保存并应用」或「添加」后列表才持久化。

## Out of Scope

- 提供商列表页 / 左侧栏管理台。
- 内置品牌打厂商 API，或经 sidecar 读 pi 本地 catalog。
- Sidecar 热加载（不重启就换模型）。
- 把内置品牌写入 `models.json`。
- 聊天顶栏模型选择器。
- OAuth 或其它非 `api_key` 认证。
- 编辑未选中的提供商而不把它设为当前项（本页下拉即草稿对象，「保存并应用」总会激活它）。

## Acceptance Criteria

- [ ] 下拉选中自定义或内置提供商时，不写 `settings.json`，不重启 sidecar。
- [ ] 点「保存并应用」后，`settings.json` 的 `defaultProvider` / `defaultModel` 与表单一致；自定义的名称 / URL / 模型列表写入 `models.json`；新 Key 写入 `auth.json`；sidecar 重启一次。
- [ ] 已配置 Key 的内置提供商只改模型即可保存；未配置 Key 时保存按钮保持禁用。
- [ ] 自定义提供商可保存 2 个以上模型；重新打开设置后列表仍在；「当前使用」只能选列表中的模型。
- [ ] 添加自定义后，当前激活提供商不变，sidecar 不因添加而重启。
- [ ] 删除自定义需确认；删激活项后配置状态为未配置；删非激活项不影响当前对话所用提供商。
- [ ] 设置 → AI 与聊天齿轮对话框行为一致（除对话框成功后关闭）。
- [ ] 自定义（含添加表单）在已有 Base URL，且有草稿 Key 或已保存 Key 时，可刷新 `GET {baseUrl}/models`；成功后可从结果中选择当前模型；失败不丢已有列表。
- [ ] 内置提供商界面没有刷新模型按钮，也不会对内置品牌发 HTTP。
- [ ] 刷新不写盘、不重启 sidecar。
- [ ] 文案走 i18n（`zh-CN` / `en`）。
- [ ] `cargo test`（`agent_config`）、相关前端测试、`npm run build` 通过。

## Key decisions

- 形态：同一页「当前使用 + 这个提供商」，不做列表+详情。
- 主操作合并为一个「保存并应用」，不再拆「保存配置」和「应用」。
- 添加自定义不自动切换。
- 远端目录只覆盖自定义 OpenAI 兼容端点；Rust 发 HTTP，不改 sidecar。
- 刷新结果先留在草稿：与已有手加 id 合并去重，保存/添加时才落盘。
