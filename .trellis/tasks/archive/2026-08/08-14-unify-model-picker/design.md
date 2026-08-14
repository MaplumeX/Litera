# Design: unify LLM model picker

## Boundaries

| Layer | Files | Change |
|---|---|---|
| UI | `src/components/AgentConfigForm.tsx` | Custom + add-form model field → searchable combobox + adjacent refresh; delete `ModelListEditor` |
| Tests | `src/components/AgentConfigForm.test.tsx` | Drive select / type-to-add / refresh through the combobox |
| i18n | `src/locales/zh-CN.ts`, `en.ts` | Search / use-typed-id / empty strings; drop unused list-editor keys if nothing references them |
| Spec | `.trellis/spec/frontend/component-guidelines.md` | Record the unified custom model combobox (Phase 3.3) |

No Rust, hook, sidecar, or type-shape change. `listRemoteModels` / `updateCustomProvider` / `switchProvider` / `save` contracts stay as they are.

`AgentConfigDialog` and `SettingsDialog` keep embedding the same form.

## Form layout

```
[当前使用]
  Provider Select
  Model
    built-in: Input (unchanged)
    custom:   ModelCombobox + RefreshRow

[这个提供商]
  built-in: API Key
  custom:   Name, Base URL, API Key, Delete
            // no model list

[保存并应用]

[+ 添加自定义提供商]

Add subform:
  Name, Base URL, API Key
  ModelCombobox + RefreshRow
  Cancel / Add
```

## ModelCombobox

Local component in `AgentConfigForm.tsx` (two call sites: current custom, add form). Do not share a module with the font picker — different create-new semantics.

Reuse the font-picker shell: `Popover` + `Command`, `modal={false}`, trigger `role="combobox"`, content width follows trigger.

```
open list → CommandItems = draft.models
click item → set current model; close
type query → cmdk filters
query trimmed, non-empty, not in models
  → extra item 「使用 {query}」
  → select it: append query to models, set current = query, close
models empty and query empty → CommandEmpty
```

Enter on the create item is enough; no separate 「添加模型」button.

Add form has no activation meaning for "current". Still keep a visible value: last typed/selected id. After refresh, if current is empty or not in the merged list, set current to `merged[0]` so the trigger is not blank. Add still submits the **full** `newModels` array.

## Refresh

Same `handleRefresh` / `listRemoteModels` as today. Move `RefreshRow` next to the combobox (`flex` row, combobox grows). Enable rules unchanged:

- Current custom: Base URL set, and draft key or saved key.
- Add form: Base URL + draft key.

Refresh does not write disk or restart. Merge is `mergeModelIds` (keep hand-added, append new). If current is missing from the merged list, set current to `merged[0] ?? ""`.

## Apply / add / delete provider

Unchanged:

- Custom apply: optional `updateCustomProvider(..., customModels)` then `switchProvider(id, model)`.
- Built-in apply: `save(provider, apiKey, model)`.
- Add: `addCustomProvider(name, url, key, newModels)` — no switch.
- Delete provider: `AlertDialog` then `deleteCustomProvider`.

`canApply` / add disable rules unchanged, except they no longer depend on a list-editor add button.

`removeModelId` and `ModelListEditor` go away.

## i18n

Add (both catalogs):

- combobox search placeholder
- 「使用 {id}」 for the create item
- empty catalog hint

Remove only keys that become unreferenced (`agent.addModel`, `agent.removeModel`, `agent.cannotDeleteLast`, and the old add-model placeholder if unused). Keep `agent.refreshModels` / `agent.refreshing` / `agent.refreshFailed`.

## Compatibility

- Existing `models.json` arrays stay valid. Users just cannot shrink them from the UI.
- Built-in-only users see no change.
- Same app version ships frontend only for this task.

## Risks

- Combobox inside `SettingsDialog` / `AgentConfigDialog` focus trap: must keep `modal={false}` (same as font picker).
- cmdk filter may hide the 「使用 {query}」 item if `value` does not contain the query. Set that item's `value`/`keywords` to the raw query.
- Tests currently look for placeholder `输入模型 id` and button `添加模型`. Rewrite those to open the combobox.

## Rollback

Revert the task commit. On-disk model arrays are unchanged in shape.
