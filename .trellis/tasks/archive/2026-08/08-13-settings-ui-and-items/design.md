# Design: settings page and typography items

## Architecture

`App` 根视图从 `"library" | "reader"` 扩成 `"library" | "reader" | "settings"`。

```
LibraryView gear ──► setView("settings"), returnTo="library"
Reader Aa      ──► setView("settings"), returnTo="reader"   (keep fileData / currentBook)
Settings back  ──► setView(returnTo)                        (never close_book)
Chat gear      ──► AgentConfigDialog                        (unchanged)
```

`SettingsDialog` 不再作为主设置面。实现上用新的 `SettingsPage` 替换它；删掉对 `SettingsDialog` 的两处挂载。

左侧分类是页面本地 state（`section: "typography" | "appearance" | "ai"`），不是路由。

## UI contract

```
+-----+------------------------------------------+
| 设置 |  返回                                     |
|     |  正在编辑《书名》的排版  /  正在编辑默认排版  |
| 排版 |                                          |
| 外观 |  (section body)                          |
|  AI  |                                          |
+-----+------------------------------------------+
```

- **排版**：字号、字体、行距、对齐、页边距。
- **外观**：主题。
- **AI**：抽出的 `AgentConfigForm`（`AgentConfigDialog` 也改用它）。

有书时，行距/边距/对齐旁在该字段存在于 `currentBook.settings` 时显示「恢复默认」。

## Presets

| Field | UI | Stored value | CSS |
|---|---|---|---|
| lineHeight | 密 / 中 / 疏 | `compact` / `normal` / `relaxed` | `1.4` / `1.7` / `2.0` |
| pageMargin | 窄 / 中 / 宽 | `narrow` / `normal` / `wide` | `max-width` 36em / 42em / 52em + `margin-inline: auto` + `padding-inline` 1.25rem / 1.75rem / 2.5rem |
| textAlign | 左齐 / 两端 | `start` / `justify` | `text-align: start` / `justify` |

Built-in defaults: `normal`, `normal`, `start`.

## Data flow

```
preferences.json ── get_preferences ──► usePreferences()
      ▲                                      │
      └──────── save_preferences ◄───────────┤  library: typography + theme
                                             │  any view: theme
library.json settings ── update_reading_state ◄── reader: fonts + typography overrides

effectiveStyle = {
  fontSize/fontFamily: book ?? builtin,
  theme: preferences.theme,
  lineHeight/pageMargin/textAlign: book.settings.?? preferences.?? builtin
}

generateStylesCss(effectiveStyle) ──► ReaderView.setStyles  (on reader mount / book ready)
```

设置页改值时立刻写存储。阅读器未挂载，所以不在设置页调用 `setStyles`。返回阅读页后 `handleBookReady` / 现有 style effect 会注入新 CSS。

## Persistence contracts

### preferences.json (schemaVersion stays 1)

```json
{
  "schemaVersion": 1,
  "theme": "light",
  "lineHeight": "normal",
  "pageMargin": "normal",
  "textAlign": "start"
}
```

- New keys: `#[serde(default)]` so a two-field file still loads.
- `ensure_file`: parsed v1 + valid theme is valid even when new keys are missing.
- `get_preferences` returns the full record (theme + three typography defaults).
- `save_preferences` accepts a partial update, reads current file under the gate, merges, writes. Theme-only callers must not wipe typography keys.
- Invalid enum values on write → `InvalidInput`. Corrupt file on read still resets to defaults.

### ReadingSettings (library.json schemaVersion stays 1)

Add optional `lineHeight`, `pageMargin`, `textAlign` (camelCase, skip if none). Same enum sets as preferences.

`validate_settings`: at least one recognized field; each present field must be in its allow-list. `theme` on the book record remains accepted for old files but is not written by this task.

Persist snapshot rules:

- Reader font change: `{ fontSize, fontFamily, lineHeight?, pageMargin?, textAlign? }` — keep any overrides still set.
- Reader typography change: same snapshot with that key set.
- Restore one key: same snapshot with that key omitted.
- Never send `{ lineHeight }` alone (would drop fonts; `update_reading_state` replaces the object).

## Component boundaries

| Piece | Owns |
|---|---|
| `App.tsx` | `view`, `settingsReturnTo`, open/back, style persist routing (book vs preferences) |
| `SettingsPage` | left nav, section bodies, restore-default buttons, “editing book vs defaults” copy |
| `src/lib/reader-styles.ts` | presets, normalize, `generateStylesCss` |
| `src/lib/preferences.ts` | load/save full preferences |
| `AgentConfigForm` | extracted from `AgentConfigDialog` |
| `AgentConfigDialog` | dialog chrome around the form |
| `ChatPanel` | still local `showConfig` only |

Do not introduce a global store. Keep settings state as props from `App`, matching `.trellis/spec/frontend/state-management.md`.

## Compatibility

- Existing books with `{ fontSize, fontFamily }` keep working.
- Existing `preferences.json` with only `theme` keeps that theme.
- Chat LLM save/restart path unchanged.
- Reader paging, library import/delete, sidecar protocol unchanged.

## Trade-offs

- Full page instead of dialog: no live preview. Accepted.
- Two shells (page AI section + chat dialog) share one form: slight duplication of chrome, one source of truth for fields.
- Enum strings in JSON rather than raw CSS numbers: validation stays a closed list, same style as font families.

## Rollback

Revert the feature branch. On-disk: extra keys in `ReadingSettings` / `preferences.json` are unknown to old `deny_unknown_fields` readers. Do not ship a mid-way preferences writer that old builds will then refuse. If we must abort after writing new keys, old builds would treat preferences as corrupt and reset theme — call that out before merge; this task and the next release must ship together, or we drop `deny_unknown_fields` on preferences (not recommended). Forward-only: once new keys are written, only this (or later) build can read them. Old books without new keys remain readable by both.
