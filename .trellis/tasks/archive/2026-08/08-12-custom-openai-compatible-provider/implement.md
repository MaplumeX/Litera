# Implement: 支持自定义 OpenAI 兼容供应商

## 执行顺序

### Step 1: Rust 后端 — models.json 读写 + CRUD 命令

**文件**: `src-tauri/src/agent_config.rs`, `src-tauri/src/lib.rs`

1.1 定义 `CustomProviderEntry` 结构体（id, name, base_url, model, has_api_key）
1.2 扩展 `AgentConfigSnapshot` 加 `custom_providers: Vec<CustomProviderEntry>`
1.3 新增 `read_models_json` / `write_models_json`（复用 `library::atomic_write`，结构 `{ providers: Map<String, Value> }`）
1.4 新增 `read_custom_providers(agent_dir)` —— 读 models.json，提取 id/name/baseUrl/models[0].id，结合 auth.json 判 has_api_key
1.5 扩展 `read_snapshot` 调 `read_custom_providers`
1.6 新增 `add_custom_provider` 命令：校验 name/base_url/api_key/model 非空（本地服务 api_key 允许占位值）→ 生成 customId → 写 models.json（含 name）+ auth.json → 返回 entry
1.7 新增 `delete_custom_provider` 命令：开头校验 `provider_id.starts_with("custom-")` 否则 `invalid_input` → 删 models.json + auth.json 条目；若是当前 defaultProvider 则清 settings.json 的 defaultProvider/defaultModel
1.8 新增 `switch_provider` 命令：merge-write settings.json 的 defaultProvider/defaultModel（并写 defaultThinkingLevel="medium" 保持与内置一致）
1.9 `save_agent_config` 保持不变（内置供应商专用）
1.10 在 `lib.rs` 注册三个新命令
1.11 新增 Rust 单元测试：add/delete round-trip、delete 激活供应商回退、models.json 原子写入、customId 前缀校验、delete_custom_provider 拒绝非 custom- 前缀 id

**验证**: `cargo test`、`cargo check`

### Step 2: 类型层 — agent-config.ts

**文件**: `src/types/agent-config.ts`

2.1 新增 `CustomProviderEntry` 接口
2.2 扩展 `AgentConfigSnapshot` 加 `customProviders: CustomProviderEntry[]`
2.3 新增 helper `isCustomProviderId(id)` —— 判断 `custom-` 前缀

**验证**: `npx tsc --noEmit`

### Step 3: 前端 hook — use-agent-config.ts

**文件**: `src/lib/use-agent-config.ts`

3.1 扩展 snapshot state（已含 AgentConfigSnapshot 类型，自动覆盖）
3.2 新增 `addCustomProvider(name, baseUrl, apiKey, model)` → invoke `add_custom_provider` → load()
3.3 新增 `deleteCustomProvider(id)` → invoke `delete_custom_provider` → load()
3.4 新增 `switchProvider(providerId, model)` → invoke `switch_provider` → `restart_sidecar` → load()

**验证**: `npx tsc --noEmit`

### Step 4: 前端 UI — AgentConfigDialog 重构

**文件**: `src/components/AgentConfigDialog.tsx`

4.1 Provider 下拉：内置项（AGENT_PROVIDERS）+ 自定义项（snapshot.customProviders，名称后标「(自定义)」）+ 分隔项「＋ 添加自定义供应商」
4.2 选中内置供应商：保持现有 apiKey + model 输入区 + 保存按钮（走 save）
4.3 选中自定义供应商：显示只读 baseUrl/model + 「删除」按钮 + 「使用此供应商」按钮（走 switchProvider）
4.4 「添加自定义供应商」表单：name + baseUrl + apiKey + model 输入 → addCustomProvider → 刷新 → 提示切换
4.5 错误/成功提示沿用现有样式

**验证**: `npx tsc --noEmit`、`npm run build`

### Step 5: 全量验证

5.1 `cargo test`
5.2 `cargo check`
5.3 `npx tsc --noEmit`
5.4 `npm run build`
5.5 手动验证路径（若可行）：添加自定义供应商 → 切换 → 对话 → 删除

## Review Gates

- Step 1 后：cargo test 通过，命令已注册
- Step 4 后：tsc + vite build 通过
- Step 5：全量绿

## Rollback Points

- Step 1 完成后若前端集成受阻：回滚 lib.rs 命令注册，前端用旧 UI
- Step 4 后若 UI 质量不达标：git revert AgentConfigDialog，保留 Rust/类型层（向后兼容）

## Validation Commands

```bash
cargo test
cargo check
npx tsc --noEmit
npm run build
```