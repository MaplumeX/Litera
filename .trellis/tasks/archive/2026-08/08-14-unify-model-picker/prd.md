# Unify LLM model picker

## Goal

自定义提供商的「选当前模型、手写新 id、刷新远端目录」收进同一个模型框。用户改模型时只跟这一处交互，不必再到「这个提供商」里维护一份列表。

## Background

当前 `AgentConfigForm` 把模型能力拆开：

- **当前使用**：自定义是只读 Select，只能选已有 id。
- **这个提供商**：`ModelListEditor` 手加/删除，「刷新模型」也在这里。

内置提供商仍是文本框，没有目录，也不能拉远端。用户要求对齐常见产品：拉取、切换、手写新 id 在同一处。

写盘语义保持上次 `08-14-provider-settings-select-apply` 的约定：草稿不写盘，「保存并应用」才写盘并重启 sidecar。

## Confirmed facts

- 入口仍是 `SettingsDialog` AI 分页和 `AgentConfigDialog`，共用 `AgentConfigForm`。
- 自定义已有 `models: string[]`；`list_remote_models` 已能对 OpenAI 兼容端点 `GET {baseUrl}/models`。
- 刷新只改草稿，失败不清空已有列表；Key 不回传前端，WebView 不得自己打 `/models`。
- 设置页字体选择已有可搜索 combobox（`popover` + `command`，`modal={false}`）。
- 添加自定义仍是独立按钮 + 内联表单；添加不激活、不重启。

## Requirements

### R1 自定义模型框合一

- 自定义提供商在「当前使用」用一个可搜索 combobox 代替只读 Select。
- 打开列表点一项 = 把该项设为当前模型（草稿，不写盘）。
- 框里打字可过滤已有 id。确认一个列表里没有的 id（回车或点「使用 {id}」）= 加入草稿目录并设为当前模型。
- 「刷新模型」紧挨这个框，不再出现在「这个提供商」。
- 「这个提供商」不再显示 `ModelListEditor`，也不提供删除单个模型 id。

### R2 目录只增不删

- 刷新把拉到的 id 合并进草稿目录（去重，保留手加项，新 id 追加）。
- 手写新 id 只追加，不覆盖已有项。
- 不能从目录里删掉已有 id。当前模型只能换成目录里的另一项，或写成一个新 id。
- 当前模型若仍在合并后的目录中则保持；若因异常不在（例如空目录后手写前），回退到目录第一项或空。

### R3 内置不变

- 内置提供商的模型仍是文本框 + 示例 placeholder。
- 内置不显示刷新，不发 `list_remote_models`，不维护模型目录。

### R4 添加表单同一控件

- 「添加自定义提供商」表单的模型区用同一个 combobox + 旁边刷新，不再用 `ModelListEditor`。
- 添加仍要求草稿目录至少一个 id；提交写入当时目录里的全部 id，不切换激活项，不重启 sidecar。

### R5 写盘与双入口

- 选用、手写、刷新都不写盘、不重启 sidecar。
- 「保存并应用」仍把当前提供商 + 当前模型（以及自定义的名称 / URL / 完整模型目录 / 新 Key）一次写盘并重启。
- `SettingsDialog` 的 AI 分页和 `AgentConfigDialog` 行为一致（对话框成功后仍可关闭）。

## Out of Scope

- 从目录删除模型 id。
- 内置品牌做 combobox、打厂商 API、或经 sidecar 读 pi catalog。
- 提供商列表管理页。
- 聊天顶栏模型选择器。
- Sidecar 热加载。
- 改 `list_remote_models` 协议，或让刷新立刻写盘。

## Acceptance Criteria

- [ ] 自定义「当前使用」只有一个模型框：能从列表选、能手写新 id、旁边能刷新。
- [ ] 「这个提供商」不再出现模型列表、添加模型输入或删除单个模型的按钮。
- [ ] 手写一个新 id 后，该 id 成为当前模型，并出现在下拉列表中；点「保存并应用」后写入 `models.json` 的完整目录。
- [ ] 点「刷新模型」把远端 id 合并进下拉列表，不调用 save / switch / update，不重启 sidecar。
- [ ] 下拉列表里没有删除入口；已有 id 刷新后仍在。
- [ ] 内置提供商仍是文本框，没有「刷新模型」，也不会调用 `list_remote_models`。
- [ ] 添加自定义表单用同一个模型框 + 刷新；添加成功不切换激活项。
- [ ] 设置 → AI 与聊天齿轮对话框交互一致（除对话框成功后关闭）。
- [ ] 文案走 i18n（`zh-CN` / `en`）。
- [ ] `AgentConfigForm` 相关测试和 `npm run build` 通过。

## Key decisions

- 内置继续手填。
- 目录只增不删。
- 刷新从「这个提供商」挪到模型框旁边。
- 选用仍是草稿，「保存并应用」才生效。
