# Design: Improve provider switching and editing

## 1. Backend changes (`src-tauri/src/agent_config.rs`)

### 1.1 `save_config`: allow empty api_key when key already exists

Current signature: `fn save_config(agent_dir: &Path, provider: &str, api_key: &str, model: &str) -> AppResult<()>`

Change:
- If `api_key` is empty: read `auth.json`, look up `provider`. If an entry with `key` exists → keep it unchanged (don't touch auth.json for that provider). If no key exists → return error (invalid_input "API key required for provider ...").
- If `api_key` non-empty: current behavior (upsert key).
- `settings.json` write unchanged (defaultProvider/defaultModel/defaultThinkingLevel).

Tauri command `save_agent_config` currently rejects empty api_key upfront:
```rust
if provider.is_empty() || model.is_empty() || api_key.is_empty() { return Err(...); }
```
Change to only require `provider` + `model` non-empty; the empty-key check moves into `save_config`.

### 1.2 New `update_custom_provider` command

New Tauri command:
```rust
#[tauri::command]
pub async fn update_custom_provider(
    app: tauri::AppHandle,
    provider_id: String,   // must start with "custom-"
    name: String,
    base_url: String,
    api_key: String,       // may be empty → keep existing
    model: String,
) -> AppResult<CustomProviderEntry>
```

`update_custom_provider_impl(agent_dir, provider_id, name, base_url, api_key, model)`:
- Validate `provider_id.starts_with("custom-")`, name/base_url/model non-empty.
- Read `models.json`, ensure `providers.<provider_id>` exists (else error "Custom provider not found").
- Update `providers.<provider_id>` = `{ name, baseUrl, api: "openai-completions", models: [{ id: model }] }`. Preserve existing `api` field value if present (read existing entry, spread update).
- If `api_key` non-empty: upsert `auth.json[provider_id] = { type: "api_key", key }`.
- If the edited provider is currently active (`settings.json.defaultProvider == provider_id`), update `defaultModel` (and keep defaultProvider). This makes model edits effective without a separate switch.
- Return updated `CustomProviderEntry { id, name, base_url, model, has_api_key: true }` (has_api_key: whether auth entry exists — keep true if key existed before even when left empty; compute from auth.json after update).

Register in `src-tauri/src/lib.rs` invoke_handler list.

### 1.3 No change to `switch_provider`

`switch_provider_impl` already writes settings.json only. Frontend will call it on select (R1) — no backend change needed.

## 2. Frontend changes

### 2.1 `src/lib/use-agent-config.ts`

- `save(provider, apiKey, model)`: pass through; backend now tolerates empty apiKey. No change needed except maybe not required.
- Add `updateCustomProvider(id, name, baseUrl, apiKey, model)` → `invoke("update_custom_provider", {...})`, then `invoke("restart_sidecar")` + `load()`. Mirrors `addCustomProvider`.

### 2.2 `src/components/AgentConfigDialog.tsx`

- **R1**: in `handleProviderChange`, when `isCustomProviderId(value)` → call `switchProvider(cp.id, cp.model)` immediately (after setting provider state). Show inline "切换中…" via `saving` flag; keep `successMessage` for result. Remove the "使用此供应商" button and `handleSwitch` (or keep handleSwitch for reuse? no — remove; selected custom provider switches on select). Keep `switchProvider` usage.
  - Careful: `handleProviderChange` is also called when switching away from custom to built-in — only switch when the *selected* value is a custom provider.
- **R2**: add "编辑" button on custom provider info card → `setEditingCustom(true)` → render edit form (name/baseUrl/apiKey/model inputs, pre-filled from `selectedCustom`, apiKey empty with placeholder "已配置,留空保持不变"). Save → `updateCustomProvider`. Cancel → back to card. Delete stays.
  - After edit, `provider` state stays the same id; model state updates from returned entry.
- **R3**: `handleSave` guard: `if (!provider || !model) return;` + `if (!apiKey && !hasExistingKey) return;`. Save button `disabled={saving || !provider || !model || (!apiKey && !hasExistingKey)}`.
- Keep `isLocalBaseUrl` hint for edit form's apiKey placeholder.

## 3. Risks / edge cases

- Selecting custom provider triggers sidecar restart → current session resets. Acceptable (existing behavior for switch).
- Race: rapid select of two custom providers → two switch_provider + restarts. `saving` flag disables select during switch to mitigate.
- `update_custom_provider` on an id that was deleted (stale UI) → error surfaced via error state; acceptable.
- Built-in provider with empty key and model-only change: `save_config` keeps existing key — verify auth.json untouched in tests.

## 4. Rollout

Single commit. Backend + frontend together (frontend depends on new command; no backward-compat issue since same app version).
