# Implement: fine-tune reader typography

## Checklist

1. **Preferences store** (`src-tauri/src/preferences.rs`)
   - Add defaulted numeric typography fields + `fontFamily`.
   - Dual-read `lineHeight`; read leftover `pageMargin` and split in `get`.
   - Patch `save_preferences` with the new number args; read-modify-write; do not write `pageMargin`.
   - `ensure_file` still accepts theme-only v1 without rewrite.
   - Rust tests: theme-only load, enum migrate, number persist, sibling keys survive a theme patch, out-of-range rejected.

2. **ReadingSettings** (`src-tauri/src/library.rs`, `src/types/library.ts`)
   - Optional numeric fields; keep `pageMargin` for old records.
   - Dual-read `lineHeight`. Range validation. Old pageMargin enum still valid.
   - Tests: old enum book loads; numeric override persists; omit-key restore; out-of-range rejected; `{fontSize,fontFamily}` still valid.

3. **Style pipeline** (`src/lib/reader-styles.ts` + tests)
   - Replace preset maps with ranges, clamp/snap helpers, enum migrate, pageMargin split.
   - `ReaderStyleState` uses numbers for continuous fields + `contentWidth` / `pagePadding`.
   - `normalizeSettings`: book ?? preferences ?? builtin for every typography key including fonts.
   - `bookSettingsSnapshot`: only overridden keys; never emit `pageMargin` / `theme`.
   - `generateStylesCss`: letter-spacing, max-width, padding-inline, `p` indent/spacing.

4. **App persist routing** (`src/App.tsx`, `src/lib/preferences.ts`)
   - Preferences type and save payload match the new contract.
   - Library typography → preferences. Reader typography → full snapshot.
   - Fonts use the same path. Compute `overriddenKeys` from all typography keys.

5. **Settings UI**
   - `npx shadcn@latest add slider` (do not use raw range input).
   - Slider rows with live value. Enable fonts in library. Restore still reader-only + present key.
   - Update `SettingsPage.test.tsx` (no more disabled S/M/L without a book; cover a slider + restore).

6. **Do not touch**
   - Chat gear / `AgentConfigDialog` ownership.
   - Settings back path (`close_book` must not run).
   - Theme CSS, paging, sidecar.

## Validation

```bash
npx shadcn@latest add slider
npm test && npm run build
cd src-tauri && cargo test preferences && cargo test --lib
```

Minimum: preferences + library settings Rust tests, `reader-styles` + `SettingsPage` frontend tests, `npm test`, `npm run build`.

## Risky files / rollback points

| File | Risk |
|---|---|
| `src-tauri/src/preferences.rs` | Theme wipe if `ensure_file` rewrites or deserialize rejects old `lineHeight` strings |
| `src-tauri/src/library.rs` | Partial snapshot drops keys; `f64` deserialize rejects `"normal"` |
| `src/lib/reader-styles.ts` | Missing migrate leaves old books on builtin defaults |
| `src/App.tsx` | Library font change still no-ops; snapshot still always writes fonts |

If preferences tests fail on “old file → theme reset” or “`lineHeight: normal` fails to parse”, stop and fix store before UI.

## Before `task.py start`

- [x] `prd.md` converged
- [x] `design.md` / `implement.md` present
- [x] research notes in `research/`
- [x] `implement.jsonl` / `check.jsonl` have real spec/research entries
- [ ] User approved this planning summary
