# Design: provider settings select-then-apply

## Boundaries

| Layer | Files | Change |
|---|---|---|
| Rust | `src-tauri/Cargo.toml`, `src-tauri/src/agent_config.rs`, `src-tauri/src/lib.rs` | `models: Vec<String>`; update does not write settings; new `list_remote_models` via `reqwest` |
| Spec | `.trellis/spec/backend/tauri-commands.md` | Sync command contracts |
| Types | `src/types/agent-config.ts` | `CustomProviderEntry.models: string[]` replaces `model: string` |
| Hook | `src/lib/use-agent-config.ts` | `updateCustomProvider` takes `models` and does not restart; add `listRemoteModels` |
| UI | `src/components/AgentConfigForm.tsx` | Two-section form; select is draft-only; one apply action; refresh on custom / add |
| i18n | `src/locales/zh-CN.ts`, `en.ts` | New/updated strings |
| Tests | `agent_config.rs` tests; new `AgentConfigForm` tests; settings/chat mocks if the hook shape changes | |

No sidecar / protocol change. `AgentConfigDialog` and `SettingsDialog` keep embedding the same form.

## Data contracts

### `CustomProviderEntry`

```rust
pub struct CustomProviderEntry {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<String>, // was `model: String`
    pub has_api_key: bool,
}
```

`read_custom_providers` collects every `models[].id` (skip empty). Existing single-model files keep working.

### `update_custom_provider`

```rust
update_custom_provider(provider_id, name, base_url, api_key, models: Vec<String>)
```

- Reject empty name / base_url, empty `models`, or any empty model id.
- Rewrite `providers.<id>.models` as `[{ "id": m }, ...]` and preserve `api`.
- Upsert `auth.json` only when `api_key` is non-empty.
- **Do not** touch `settings.json`. Activation is exclusively `switch_provider` / `save_agent_config`.

This drops the old “if active, set `defaultModel` to the single model” side effect. The apply path always follows with `switch_provider(id, selectedModel)`.

### `add_custom_provider`

```rust
add_custom_provider(name, base_url, api_key, models: Vec<String>)
```

- Same validation as update for name / url / key / non-empty `models`.
- Writes `models: [{ "id": m }, ...]`. Does not write `settings.json`.
- Keep a thin wrapper if the old single-`model` argument is easier for the existing command: prefer one `models` argument so a refresh-then-add keeps the full catalog.

### `save_agent_config` / `switch_provider` / `delete_custom_provider`

Unchanged semantics. `save_agent_config` remains the built-in apply (key + settings). `switch_provider` remains custom apply (settings only).

### Snapshot

`AgentConfigSnapshot.{ provider, model, hasApiKey, customProviders }` unchanged except each custom row carries `models` instead of `model`.

### `list_remote_models`

```rust
list_remote_models(base_url: String, api_key: String, provider_id: Option<String>) -> Vec<String>
```

- `base_url` required. Join as `{trim_end_matches('/')} + "/models"`.
- Resolve key: if `api_key` non-empty, use it; else if `provider_id` starts with `custom-` and `auth.json` has that key, use the stored key; else `InvalidInput`.
- `GET` with `Authorization: Bearer <key>`, `Accept: application/json`, ~10s timeout, response body cap (~1 MiB).
- Parse with a pure helper `parse_openai_model_ids(&[u8]) -> AppResult<Vec<String>>`: prefer `data[].id`; also accept a top-level string array. Drop empty ids; de-dupe preserving order.
- Empty parsed list → `InvalidInput` ("no models returned").
- HTTP / timeout / non-success status → `InvalidInput` with status/reason, **never** the key.
- Do not write any agent JSON files. Do not log the key or the Authorization header.

Add `reqwest` with `rustls-tls` (no default-tls / native-openssl). The Tauri command is async and calls reqwest directly; the JSON parser stays unit-tested without the network.

Register the command in `src-tauri/src/lib.rs`.

## Frontend apply

Draft state in the form: `provider`, `model`, plus config fields for the selected provider. Opening the form (or `active` flip) seeds draft from snapshot; it does not write.

**Apply (`保存并应用`)** — one user action, at most one sidecar restart:

```
if custom:
  update_custom_provider(id, name, url, key, models)   // no restart
  switch_provider(id, selectedModel)                   // restart + reload
else:
  save_agent_config(provider, apiKey, model)           // restart + reload
```

Skip `update_custom_provider` when name / url / key / models are unchanged; still `switch_provider` so a model-only change applies.

Disable apply when: no provider; no model; custom model not in the list; built-in or custom has no key and the key field is empty.

**Add**: existing `add_custom_provider` + `load()`. Do not `switch_provider`. Do not change the draft provider. Success copy: added, pick it from the list and apply to use it.

**Delete**: `AlertDialog` → `delete_custom_provider`. Restart sidecar only when `snapshot.provider === deletedId` (hook should grow an explicit flag or the form calls `restart_sidecar` in that case). If the deleted id was the draft, reset draft to `AGENT_PROVIDERS[0]` with empty model/key.

## Form layout

```
[当前使用]
  Provider Select   // built-ins + customs; no add sentinel
  Model             // Input (built-in) or Select of entry.models (custom)

[这个提供商]
  built-in: API Key
  custom:   Name, Base URL, API Key
            model chips + add field + 「刷新模型」
            Delete (opens AlertDialog)

[保存并应用]   // and Cancel/Close only when `onClose` is passed

[+ 添加自定义提供商]  // toggles the existing add subform
```

Add subform replaces the two sections until cancelled or submitted (same as today’s inline add, just no longer launched from the Select).

`Select` grouping stays: built-in group, custom group. Follow existing shadcn Select rules; do not put a sentinel item back.

Custom model list editor: one input + add, each row removable if `models.length > 1`. Adding a model also sets it as the draft current model so apply can use it immediately.

**Refresh models** (custom section and add subform only):

```
ids = listRemoteModels(baseUrl, draftKey, providerId?)
draft.models = unique(existing ++ ids)   // keep hand-added ids
if current model not in draft.models: current = draft.models[0]
```

Disable the button when Base URL is empty, or when there is no draft key and (add form or custom has `hasApiKey === false`). Show a small loading state on the button; do not flip the whole form `saving` flag (that would look like apply).

## Hook changes

- `updateCustomProvider(id, name, baseUrl, apiKey, models)` → invoke only + `load()`. **No** `restart_sidecar`.
- `deleteCustomProvider(id)` stays invoke + `load()`. Form restarts sidecar when the deleted provider was active.
- `switchProvider` / `save` keep restart (apply path).
- `listRemoteModels(baseUrl, apiKey, providerId?)` → invoke only; no disk write, no restart.

## i18n

New/adjusted keys (both catalogs):

- Section titles: current use / this provider
- Apply button (reuse `agent.save` or add `agent.apply`)
- Add-without-switch success
- Delete confirm title/description
- Model list add / cannot delete last
- Refresh models / refreshing / refresh failed
- Remove unused “switched on select” copy if nothing references it

## Compatibility

- Same app version ships frontend + Rust together; no need to keep `model: string` on the wire.
- On-disk `models.json` with a one-element array is valid.
- Built-in-only users never touch `models.json`.

## Risks

- Apply does update then switch: if switch fails after update, definition is saved but activation is not. Surface the hook error; user can apply again. Do not add a compensating transaction.
- Two hook instances (`ChatPanel` + form) already exist. Apply still goes through the form’s hook + `restart_sidecar`; `ChatPanel` reloads config on its own path. Keep that.
- Rapid apply clicks: keep `saving` disabling the form.
- Refresh against a huge `/models` payload: enforce the body cap and surface `InvalidInput`.

## Rollback

Revert the task commit. `models.json` with multiple ids remains readable by the old “first id only” code if we ever roll back the binary; the extra ids would be ignored, not corrupt.
