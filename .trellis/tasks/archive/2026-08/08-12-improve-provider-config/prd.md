# Improve provider switching and editing

## Goal

改善供应商切换与配置编辑体验:自定义供应商下拉选中即切换;供应商配置支持二次编辑;内置供应商在已配置 API Key 时改配置无需重输 Key。

## Background

当前 `AgentConfigDialog` 的体验问题:

1. **自定义供应商不能"选中即切换"** —— 下拉选中后只显示只读信息卡片,必须再点"使用此供应商"按钮才调用 `switch_provider`,多一步且行为割裂。
2. **自定义供应商配置无法二次编辑** —— 选中后信息卡片只读,只有"使用此供应商"和"删除"两个操作;填错的名称/Base URL/API Key/Model 只能删了重加。后端也只有 `add_custom_provider` / `delete_custom_provider`,没有更新命令。
3. **内置供应商改配置必须重输 API Key** —— 保存按钮禁用条件包含 `!apiKey`,即使 auth.json 里已保存 key,修改 Model 也强制重新粘贴 Key。后端 `save_config` 同样强制 `api_key` 非空。

存储结构(均由 Rust `agent_config.rs` 管理):
- `models.json` → `providers.<custom-id>` 存 `{ name, baseUrl, api, models: [{ id }] }`
- `auth.json` → `<provider-id>` 存 `{ type: "api_key", key }`
- `settings.json` → `defaultProvider` / `defaultModel` / `defaultThinkingLevel`

切换/保存后需重启 sidecar 才生效 —— 本次保留该行为(重启问题不在范围内)。

## Requirements

### R1 自定义供应商选中即切换

- 下拉选中一个自定义供应商时,立即调用 `switch_provider(providerId, model)` 并重启 sidecar,不再需要"使用此供应商"按钮。
- 移除信息卡片上的"使用此供应商"按钮。
- 切换中状态(禁用、加载提示)要保留。

### R2 自定义供应商支持二次编辑

- 信息卡片提供"编辑"入口。
- 编辑表单复用添加表单的字段:名称 / Base URL / API Key / Model。
- API Key 为空时保留原 key(placeholder 提示"已配置,留空保持不变");填了则替换。
- 编辑保存后更新 models.json(名称/Base URL/Model)与 auth.json(若有新 key),并重启 sidecar 生效。
- 编辑后当前选中的下拉项仍指向该供应商(名称可能变了)。

### R3 内置供应商已配置 Key 时允许留空

- 后端 `save_config`:api_key 为空且 auth.json 已有该 provider 的 key 时,保留原 key;该 provider 完全没有 key 时才报错。
- 前端保存按钮禁用条件改为:model 必填;api_key 在未配置 key 时必须填,已配置时可留空。
- 已配置 key 时输入框 placeholder 保持"已配置(重新输入以修改)",留空保存即保留原 key。

## Acceptance Criteria

- [ ] 下拉选中自定义供应商即触发切换,信息卡片不再有"使用此供应商"按钮。
- [ ] 自定义供应商可编辑名称/Base URL/API Key/Model;Key 留空保存保留原 key;保存后重启 sidecar。
- [ ] 内置供应商已配置 key 时,留空 apiKey 仅改 model 可保存成功;未配置 key 时仍要求填写。
- [ ] `cargo test`(agent_config 相关测试)与 `npm run build` 通过。

## Notes

- 切换/编辑/保存后的重启 sidecar 行为保持现状,不做热切换。
- 不改变 `add_custom_provider` / `delete_custom_provider` 的既有行为。