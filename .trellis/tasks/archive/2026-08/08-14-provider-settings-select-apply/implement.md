# Implement: provider settings select-then-apply

## Checklist

### Backend

- [ ] 1. `CustomProviderEntry.model` → `models: Vec<String>`. `read_custom_providers` collects every `models[].id`.
- [ ] 2. `add_custom_provider` / `update_custom_provider` take `models: Vec<String>` (non-empty, no blank ids). Update writes the full array and stops writing `settings.json`.
- [ ] 3. Add `reqwest` (`rustls-tls`) and `list_remote_models`. Extract `parse_openai_model_ids` + `models_endpoint_url` for tests. Command reads `auth.json` only when `api_key` is empty and `provider_id` is `custom-*`.
- [ ] 4. Adjust Rust tests:
  - read snapshot returns all model ids
  - update writes multiple models and preserves `api` + existing key
  - update of an active custom provider does **not** change `settings.json`
  - add still writes a one-element `models` array
  - empty `models` is `InvalidInput`
  - parser: `data[].id`, string array, empty → error, ignores blank ids
  - url join strips trailing slash
  - empty base_url / unresolved key → `InvalidInput`

### Frontend types + hook

- [ ] 5. `CustomProviderEntry.models: string[]`. Update every TS usage (`AgentConfigForm`, tests, mocks).
- [ ] 6. `updateCustomProvider(..., models)` invoke; **remove** `restart_sidecar` from this method.
- [ ] 7. Keep `save` / `switchProvider` restart behavior. Add `listRemoteModels`.

### UI

- [ ] 8. Rewrite `AgentConfigForm` into 当前使用 + 这个提供商. Dropdown is draft-only.
- [ ] 9. Single「保存并应用」: custom → optional update + `switchProvider`; built-in → `save`.
- [ ] 10. Add custom via button + existing inline form; do not switch or restart. Add form includes refresh.
- [ ] 11. Delete via `AlertDialog`. Restart sidecar only if the deleted id was `snapshot.provider`.
- [ ] 12. Custom model list editor (add / remove, min one) + 「刷新模型」. Merge fetched ids; do not clear on failure.
- [ ] 13. i18n both catalogs. Drop copy that implies select-to-switch.

### Spec + tests

- [ ] 14. Update `.trellis/spec/backend/tauri-commands.md` (`models` array; update does not write settings; `list_remote_models` contract).
- [ ] 15. `AgentConfigForm` tests: select does not invoke switch; apply does; add does not switch; delete confirm required; refresh merges ids and is absent for built-in.
- [ ] 16. Fix `SettingsDialog.test.tsx` / `ChatPanel.test.tsx` mocks if the hook/entry shape changes.

### Validation

- [ ] 17. `cargo test --manifest-path src-tauri/Cargo.toml agent_config`
- [ ] 18. Frontend unit tests for the touched files
- [ ] 19. `npm run build`

## Review gates

- After step 4: Rust tests green (including parser) before UI rewrite.
- After step 15: form tests cover “select does not write” and “refresh is custom-only”.
- After step 19: ready for Phase 2.2 check.

## Rollback points

- Backend-only (steps 1–3) is not shippable alone: the TS `model` field would break. Land backend + types + UI together.
- If the form rewrite is wrong, revert `AgentConfigForm.tsx` and keep backend `models: Vec<String>` only if the hook already matches.

## Notes

- Dispatch prompt must start with `Active task: .trellis/tasks/08-14-provider-settings-select-apply`.
- Do not restart sidecar inside `updateCustomProvider`.
- Do not put「添加自定义」back into the Select.
- Do not fetch models for built-in providers.
- Do not add a sidecar protocol command for listing models.
