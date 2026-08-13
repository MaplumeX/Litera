# Design: Add i18n support

## Architecture

Frontend-only. No Rust command, no sidecar, no `preferences.json` field.

```
OS / localStorage
        ↓
 src/lib/i18n.ts   (locale store + t() + detectLocale)
        ↓
 components call useT() / t()
        ↓
 Settings appearance → setLocale('zh-CN' | 'en')
```

### Why not preferences.json

`PreferencesDataRaw` uses `deny_unknown_fields`. A new `locale` key would make older builds treat `preferences.json` as corrupt and reset theme/typography. Persistence therefore uses WebView `localStorage` (`litera.locale`).

### Why not React Context

`.trellis/spec/frontend/state-management.md` forbids a global state library and React Context. Locale is a module store; React components subscribe with `useSyncExternalStore`. Non-React code (`agent-reducer.ts`) calls `t()` directly.

## Contracts

### Locale

```ts
type AppLocale = "zh-CN" | "en";
```

- Saved value must be exactly `zh-CN` or `en`. Anything else is ignored and treated as unset.
- Unset → `detectLocale()` → persist the resolved value so the next launch is stable.

### `t(key, vars?)`

- Keys are dotted strings, e.g. `library.import`, `settings.restoreDefault`.
- `vars` is `Record<string, string | number>`.
- Replacement is `{name}` only. No ICU, no nested objects as values.
- Missing key: return the key (and warn in dev).

### Catalogs

- `src/locales/zh-CN.ts` and `src/locales/en.ts` export the same `MessageKey` set.
- Unit test: `Object.keys(zhCN).sort()` equals `Object.keys(en).sort()`.

### DOM

`setLocale` updates `document.documentElement.lang` (`zh-CN` or `en`).

## Data flow

1. App boot (`main.tsx` or first `useT()`): `initLocale()` reads `localStorage`, else detects OS, then writes the resolved locale and sets `documentElement.lang`.
2. User picks a language in Settings → 外观: `setLocale(next)` writes storage, notifies subscribers, updates `lang`. Mounted views re-render.
3. Tests call `setLocale("zh-CN")` in a Vitest setup file so existing Chinese assertions keep working.

## Component changes

- `SettingsPage` appearance section: language row next to theme. Labels are native names: 中文 / English.
- All user-visible React strings in `src/components/**` (except `src/components/ui/*` primitives) and the hardcoded strings in `src/lib/book-import.ts`, `src/lib/agent-reducer.ts`, `src/lib/reader-styles.ts` labels, and `src/App.tsx` move to catalogs.
- `reader-styles.ts` keeps `value` / `css`; labels are translated at the render site (`SettingsPage`), not stored in the style module as the source of truth.
- `window.alert` / notice prefixes stay as UI wrappers: `t("reader.openFailed", { message })`. The `{message}` part remains the backend English text.

## Test plan

- `src/lib/i18n.test.ts`: detect `zh*`, persist, interpolate, missing key, catalog key parity.
- Vitest setup pins `zh-CN`.
- One component test (Settings or Library) switches to `en` and asserts an English string.
- Existing Chinese role/text queries stay as-is.

## Compatibility / rollback

- Adding `localStorage` does not affect `preferences.json` or old binaries.
- Removing the feature: leftover `litera.locale` is ignored.
- No migration of existing preference files.

## Trade-offs

- Language is not next to theme in the same persistence file. Accepted: avoids wiping prefs on downgrade.
- `zh-TW` users get Simplified Chinese. Accepted for MVP (no third catalog).
- Default session title `"新会话"` is created in the reducer via `t()` at event time. Switching language later does not rename already-stored sessions.
