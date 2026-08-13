# Implement: Add i18n support

## Checklist

1. Add `src/lib/i18n.ts` (`AppLocale`, `detectLocale`, `initLocale`, `getLocale`, `setLocale`, `t`, `useT`) and catalogs `src/locales/zh-CN.ts`, `src/locales/en.ts`.
2. Add `src/lib/i18n.test.ts` (detection, persistence, interpolation, key parity).
3. Add a Vitest setup file that calls `initLocale` / `setLocale("zh-CN")`; wire it in `vite.config.ts` `test.setupFiles`.
4. Call `initLocale()` from `src/main.tsx` before render.
5. Add language row to `SettingsPage` appearance; pass `locale` + `onLocaleChange` or call `useT`/`setLocale` there.
6. Replace hardcoded UI strings, grouped by surface:
   - `App.tsx` banners / alerts / aria-labels
   - `LibraryView` + `BookCard` + `BookImportFeedback` + `src/lib/book-import.ts`
   - `SettingsPage` + font/align labels
   - `TocSidebar`
   - chat: `ChatPanel`, `ChatInput`, `EmptyState`, `SessionList`, `TypingIndicator`, `AgentConfigForm` / `AgentConfigDialog`
   - `src/lib/agent-reducer.ts` default session title
7. Keep existing Chinese test queries. Add one English-switch assertion (Settings or Library).
8. Run `npx vitest run`, `npx tsc --noEmit`.

## Validation

```bash
npx vitest run
npx tsc --noEmit
```

Manual: Settings → 外观 switch 中文 / English; restart app; confirm book text and raw backend errors stay untranslated.

## Risky files

- `src-tauri/src/preferences.rs` — do **not** add `locale`.
- `src/lib/reader-styles.ts` — do not change value tokens; only stop using hardcoded labels as the only copy source.
- Tests that query Chinese roles (`导入`, `设置`, `衬线`, `新会话`) — they depend on the zh-CN test default.

## Rollback

Revert the frontend i18n files and string replacements. Delete `litera.locale` from localStorage if needed. No backend rollback.
