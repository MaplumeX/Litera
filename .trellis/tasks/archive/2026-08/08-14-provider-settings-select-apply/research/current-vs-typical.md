# Current provider settings vs typical apps

## Current Litera flow

`AgentConfigForm` is one dropdown that both selects the active provider and manages custom entries.

- Built-in: API Key + Model + Save → `save_agent_config` + `restart_sidecar`.
- Custom: selecting the option immediately calls `switch_provider` + `restart_sidecar`. Main view is a read-only card; Edit opens a second form; model is a field on the provider.
- Add custom is a sentinel `SelectItem` (`__add_custom__`).
- Backend `read_custom_providers` / `update_custom_provider_impl` persist only `models[0]`.

Storage (unchanged by this task):

- `auth.json[<id>] = { type: "api_key", key }`
- `settings.json` `defaultProvider` / `defaultModel` / `defaultThinkingLevel`
- `models.json` `providers.<custom-id> = { name, baseUrl, api: "openai-completions", models: [{ id }] }`

## Typical app split

Chatbox / Continue / Cherry Studio separate:

1. **Manage** a provider (endpoint, key, model catalog).
2. **Select** which provider + model the current chat uses.

Selecting a model is cheap and local. Editing a provider does not have to activate it.

## Chosen MVP

Same settings page, two sections, one apply button. No provider admin list. Custom `models` array becomes a real list. Dropdown never writes. Add does not activate.

Sidecar still restarts only after a successful disk write that must take effect now (apply, or delete of the active provider).
