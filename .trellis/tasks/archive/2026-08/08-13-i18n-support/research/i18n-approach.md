# Research: frontend i18n approach

## Problem

Need two UI catalogs (`zh-CN`, `en`), interpolation (book titles, counts), immediate switch, persisted choice, and no translation of backend errors or book content.

## Options

### A. In-house catalogs + `t()` (recommended)

`src/lib/i18n.ts` + `src/locales/zh-CN.ts` + `src/locales/en.ts`.

- `t(key, vars?)` does `{name}` replacement.
- Locale lives in a module store; `useLocale()` uses `useSyncExternalStore`.
- Persist to `localStorage` key `litera.locale`.
- No new npm dependency.

Fits current frontend: no Redux/Zustand/Context (`.trellis/spec/frontend/state-management.md`). Two locales and simple interpolation do not justify i18next.

Plural rule: Chinese has no plural inflection. English can use two keys (`library.deleteOne`, `library.deleteMany`) or a single `Delete {count} books` string. Prefer two keys where grammar differs; do not add a plural engine.

### B. i18next + react-i18next

Handles plurals, fallbacks, and nested keys. Adds runtime, plugin config, and usually a Provider (Context). Overkill for two locales and ~150 strings.

### C. Persist locale in `preferences.json`

Theme already lives there, so this looks consistent. Rejected: `PreferencesDataRaw` uses `deny_unknown_fields`. Adding `locale` makes older builds treat the file as corrupt and reset theme/typography (`src-tauri/src/preferences.rs`). That contradicts the existing "do not rewrite new keys" compatibility rule.

`localStorage` stays in the WebView, is ignored by old builds, and matches "UI only".

## Detect OS language

Use `navigator.languages` then `navigator.language`. First tag whose primary subtag is `zh` → `zh-CN`; otherwise `en`. `zh-TW` / `zh-HK` map to the Simplified catalog in this MVP (no Traditional catalog).

## Test default

jsdom typically reports `en-US`. Vitest must pin locale to `zh-CN` before components render, or existing Chinese assertions fail. Provide `setLocale` for tests that need `en`.

## Missing keys

`t()` returns the key and `console.warn` in dev if missing. Both catalogs must have the same key set; add a unit test that compares key lists.
