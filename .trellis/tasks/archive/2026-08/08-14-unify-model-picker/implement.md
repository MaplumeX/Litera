# Implement: unify LLM model picker

## Checklist

1. Add i18n keys in `zh-CN.ts` and `en.ts` (search placeholder, use-typed-id, empty hint). Leave refresh strings. Delete list-editor keys only after the form no longer references them.
2. In `AgentConfigForm.tsx`, add a local `ModelCombobox` using existing `popover` + `command` (`modal={false}`). Support pick, filter, and 「使用 {query}」 to append + select.
3. Replace the custom current-model `Select` with `ModelCombobox` + `RefreshRow` in 「当前使用」. Remove `ModelListEditor` and refresh from 「这个提供商」.
4. Replace the add-form `ModelListEditor` the same way. Add still requires `newModels.length > 0` and still does not switch.
5. Delete `ModelListEditor`, `removeModelId`, and any now-dead helpers. Keep `addModelId` only if the combobox still needs it; otherwise fold append+select into the combobox handler.
6. Update `AgentConfigForm.test.tsx`:
   - add-custom types a new id via the combobox (no 「添加模型」button)
   - refresh still merges and does not save/switch; new ids visible when the list is opened
   - built-in still has no refresh and still applies through `save`
   - provider change still does not write
7. Run `npx vitest run src/components/AgentConfigForm.test.tsx` and `npm run build`.

## Validation

```bash
npx vitest run src/components/AgentConfigForm.test.tsx src/components/settings/SettingsDialog.test.tsx
npm run build
```

No `cargo test` required unless a file under `src-tauri/` is touched (it should not be).

## Risky points

- Dialog + popover focus: `modal={false}` on the model popover.
- cmdk must show the create item for a novel query.
- Do not call `list_remote_models` for built-in.
- Do not reintroduce per-model delete.

## Rollback

Revert the commit. No migration.
