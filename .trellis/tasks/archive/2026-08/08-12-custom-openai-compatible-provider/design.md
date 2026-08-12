# Design: 支持自定义 OpenAI 兼容供应商

## 边界

改动集中在三层，sidecar / protocol 零改动：

| 层 | 文件 | 改动 |
|----|------|------|
| Rust 后端 | `src-tauri/src/agent_config.rs` | 扩展 + 新增 models.json 读写、CRUD 命令 |
| 类型层 | `src/types/agent-config.ts` | 自定义供应商类型、合并内置+自定义列表 |
| 前端 UI | `src/components/AgentConfigDialog.tsx` | 重构为内置/自定义两段式 |
| 前端 hook | `src/lib/use-agent-config.ts` | 新增 add/delete 自定义供应商调用 |

## 数据契约

### models.json（新建，Rust 原子写入）

```json
{
  "providers": {
    "custom-<uuid8>": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "models": [{ "id": "llama-3.1" }]
    }
  }
}
```

- provider 条目含 `name`（pi schema 允许 optional `name`，不会报错），用于 `get_agent_config` 回显；**无 `apiKey`**（走 auth.json）
- `api` 恒为 `openai-completions`
- 不存在时文件缺失视为空 `{}`，Rust 首次写入时创建

### customId 生成

`custom-` + 8 位随机十六进制（`rand` crate 或 `DefaultHasher` + 时间戳）。`custom-` 前缀避免与内置 id（anthropic、openai 等）冲突，且让 Rust 能区分"内置 vs 自定义"以决定 models.json 是否需要更新。

### auth.json / settings.json

沿用现有格式，无 schema 变更：
- `auth.json` 追加 `"<customId>": { "type": "api_key", "key": "..." }`
- `settings.json` 切换时写 `defaultProvider` / `defaultModel`

## Rust 命令设计

### 现有命令扩展

`get_agent_config` 返回值 `AgentConfigSnapshot` 扩展：

```rust
pub struct AgentConfigSnapshot {
    pub configured: bool,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub has_api_key: bool,
    pub custom_providers: Vec<CustomProviderEntry>,  // 新增
}

pub struct CustomProviderEntry {
    pub id: String,           // "custom-xxxxxxxx"
    pub name: String,         // UI 显示名
    pub base_url: String,
    pub model: String,
    pub has_api_key: bool,    // 不回传 key 明文
}
```

`name` 与 `model` 需持久化以便 `get_agent_config` 回显。方案：在 models.json 的 provider 条目里加 `name`（pi 的 schema 允许 `name` 字段，不会报错），model id 从 `models[0].id` 读。这样 models.json 自包含 UI 回显所需信息，无需额外文件。

models.json 结构（provider 条目含 `name`）：
```json
{
  "providers": {
    "custom-abc12345": {
      "name": "本地 Ollama",
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "models": [{ "id": "llama-3.1" }]
    }
  }
}
```

### 新增 Tauri 命令

```rust
#[tauri::command]
pub async fn add_custom_provider(
    app: tauri::AppHandle,
    name: String, base_url: String, api_key: String, model: String,
) -> AppResult<CustomProviderEntry>  // 返回生成的 entry（含 id）

#[tauri::command]
pub async fn delete_custom_provider(
    app: tauri::AppHandle,
    provider_id: String,
) -> AppResult<()>
```

`add_custom_provider`：
1. 校验 name/base_url/api_key/model 非空（本地服务 api_key 允许占位值）
2. 生成 customId
3. models.json 追加 provider 条目（含 name/baseUrl/api/models）
4. auth.json 追加 key 条目
5. 返回 entry（前端可立即更新列表，无需重载）

`delete_custom_provider`：
1. 校验 `provider_id` 以 `custom-` 开头，否则 `invalid_input`（防止误删内置供应商凭据）
2. models.json 移除条目
3. auth.json 移除 key 条目
4. 若 `settings.json.defaultProvider == provider_id`：清除 defaultProvider/defaultModel（回退未配置）

`save_agent_config`（切换激活供应商）：保持现有签名 `(provider, api_key, model)`，但对自定义供应商 api_key 可传空串或占位 —— **设计选择**：切换到自定义供应商时，key 已在 add 时写入 auth.json，`save_agent_config` 只需写 settings.json 的 defaultProvider/defaultModel，api_key 参数对自定义供应商忽略（仅校验非空当 provider 是内置时）。

更清晰的方案：`save_agent_config` 增加 `provider_type` 参数区分内置/自定义，或新增 `switch_provider` 命令。**决定**：新增 `switch_provider(provider_id, model)` 命令统一处理切换（只写 settings.json，不动 auth.json），`save_agent_config` 保留给内置供应商的"首次配置 key+model+provider"。这样职责清晰：
- 内置供应商：`save_agent_config`（写 key + 切换）
- 自定义供应商：`add_custom_provider`（写 key + models.json）→ `switch_provider`（切换）
- 删除：`delete_custom_provider`

`switch_provider`：merge-write settings.json 的 defaultProvider/defaultModel，并写 `defaultThinkingLevel: "medium"`（与 `save_config` 内置供应商行为一致；不写则依赖 pi 默认值，不致命但不一致）。

## 前端设计

### agent-config.ts

```typescript
export interface CustomProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface AgentConfigSnapshot {
  configured: boolean;
  provider: string | null;
  model: string | null;
  hasApiKey: boolean;
  customProviders: CustomProviderEntry[];  // 新增
}
```

`AGENT_PROVIDERS`（内置列表）保持不变。合并显示：下拉框 = 内置 + 自定义（自定义项加标识，如名称后附 `(自定义)`）。

### AgentConfigDialog 重构

当前是单页表单（provider 下拉 + apiKey + model）。重构为：

1. **Provider 下拉**：内置项 + 自定义项 + 「添加自定义供应商…」入口
2. 选中内置供应商：显示现有 apiKey + model 输入区（行为不变）
3. 选中自定义供应商：显示只读信息（baseUrl、model）+ 「删除」按钮；apiKey 不回显，提供「修改 Key」入口（可选，MVP 可省略，删除+重新添加即可）
4. 「添加自定义供应商」：弹出子表单（name + baseUrl + apiKey + model）→ `add_custom_provider` → 刷新列表 → 可选自动 `switch_provider`

### use-agent-config.ts

新增：
- `addCustomProvider(name, baseUrl, apiKey, model)` → invoke `add_custom_provider`
- `deleteCustomProvider(id)` → invoke `delete_custom_provider`
- `switchProvider(providerId, model)` → invoke `switch_provider`
- `load()` 后 snapshot 包含 customProviders

## 数据流

### 添加自定义供应商

```
UI 子表单提交 → addCustomProvider → invoke add_custom_provider
  → Rust: 生成 customId, 写 models.json + auth.json
  → 返回 entry → UI 刷新列表
  → 用户点「使用此供应商」→ switchProvider → invoke switch_provider
    → Rust: 写 settings.json → restart_sidecar
```

### 切换到自定义供应商

```
UI 下拉选自定义项 → switchProvider(customId, model) → invoke switch_provider
  → Rust: 写 settings.json { defaultProvider: customId, defaultModel: model }
  → UI 调 restart_sidecar → pi 重启读 models.json + auth.json + settings.json
```

### 删除自定义供应商

```
UI 删按钮 → deleteCustomProvider(id) → invoke delete_custom_provider
  → Rust: 删 models.json + auth.json 条目; 若是当前激活则清 settings.json
  → UI 刷新; 若删的是当前激活, snapshot 回退未配置
```

## 兼容性

- 现有内置供应商流程零改动（save_agent_config 签名不变）
- models.json 不存在时 Rust 视为空，首次添加时创建 —— 不影响纯内置用户
- `get_agent_config` 新增 `customProviders` 字段，前端旧代码不读该字段，无破坏性

## 回滚

- Rust 命令注册在 `lib.rs`，回滚移除注册即可
- models.json 文件可手动删除回退
- 前端 AgentConfigDialog 重构可通过 git revert 回滚