# Implement: Improve provider switching and editing

## Ordered checklist

### Backend (`src-tauri/src/agent_config.rs`, `src-tauri/src/lib.rs`)

- [ ] 1. `save_config`: allow empty `api_key` when `auth.json` already has a key for `provider`; error otherwise. Update `save_agent_config` command's upfront validation (require only provider+model).
- [ ] 2. Add `update_custom_provider` Tauri command + `update_custom_provider_impl`: update name/baseUrl/model in models.json, upsert key in auth.json when api_key non-empty, update settings.json defaultModel when active provider; return `CustomProviderEntry`.
- [ ] 3. Register `update_custom_provider` in `src-tauri/src/lib.rs` invoke_handler.
- [ ] 4. Add/update Rust tests: empty-key save keeps existing key; empty-key save errors when no key; update_custom_provider updates fields & preserves key when api_key empty; update_custom_provider on missing id errors.

### Frontend

- [ ] 5. `src/lib/use-agent-config.ts`: add `updateCustomProvider(id, name, baseUrl, apiKey, model)` (invoke → restart_sidecar → load).
- [ ] 6. `src/components/AgentConfigDialog.tsx` R1: selecting a custom provider in dropdown immediately calls `switchProvider`; remove "使用此供应商" button + `handleSwitch`.
- [ ] 7. R2: "编辑" button on custom provider card → edit form (name/baseUrl/apiKey/model, key placeholder "已配置,留空保持不变") → save via `updateCustomProvider`.
- [ ] 8. R3: save guard & button disabled logic allow empty apiKey when `hasExistingKey`.

### Validation

- [ ] 9. `cargo test` passes (agent_config module).
- [ ] 10. `npm run build` passes (no TS errors).
- [ ] 11. Manual smoke: add custom → select switches immediately; edit custom fields; built-in model-only change with saved key.

## Review gates

- After step 4: backend compiles + tests green before frontend work.
- After step 8: full build + tests green.

## Rollback points

- Backend-only commit first (steps 1–4), then frontend commit (5–8). If frontend is problematic, backend changes are independently shippable (empty-key save is additive).
