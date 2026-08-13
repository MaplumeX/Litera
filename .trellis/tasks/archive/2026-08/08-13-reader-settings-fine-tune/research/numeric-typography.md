# Numeric typography persistence and CSS

## Dual-read is required

Stored `lineHeight` is currently an enum string (`compact|normal|relaxed`). `pageMargin` is `narrow|normal|wide`. After this task they become numbers (`1.7`, plus split `contentWidth` / `pagePadding`).

`PreferencesData` and `ReadingSettings` both use `deny_unknown_fields`. Changing `lineHeight` from `String` to `f64` will fail to deserialize existing files (`"normal"`). Custom deserialize must accept:

- old enum strings
- JSON numbers
- optionally numeric strings

Map on read:

| old | numbers |
|---|---|
| lineHeight compact / normal / relaxed | 1.4 / 1.7 / 2.0 |
| pageMargin narrow / normal / wide | contentWidth 36 / 42 / 52 em, pagePadding 1.25 / 1.75 / 2.5 rem |

If `contentWidth` or `pagePadding` is already present, it wins over leftover `pageMargin`. New writes omit `pageMargin`.

Keep `schemaVersion = 1`. `ensure_file` must not rewrite a valid v1 file that is missing new keys. `save_preferences` stays a patch / read-modify-write.

Forward-only: once new keys are written, older `deny_unknown_fields` builds treat `preferences.json` as corrupt and reset theme. Same risk as `08-13-settings-ui-and-items`.

## `update_reading_state` still replaces the object

Frontend must send the full per-book snapshot of overrides still in effect. After fonts become overridable, `fontSize` / `fontFamily` are optional keys like the others. Restore-default = omit that key. Do not send a one-key patch.

## CSS injection

`generateStylesCss` → `view.renderer.setStyles` is the only path.

- `html, body`: `font-size`, `font-family`, `line-height`, `letter-spacing`, `max-width`, `padding-inline`, `text-align`
- `p`: `margin-block-end` (段距), `text-indent` (首行缩进), with `!important` so EPUB chapter CSS does not win

Injecting `p` rules changes books that shipped their own paragraph CSS. Accepted: the reader now owns those two knobs.

Builtin `paragraphSpacing = 1.0` (em) approximates the CSS `p` default so most books do not collapse. Builtin `letterSpacing = 0` and `firstLineIndent = 0` are identity / current look.

## Settings UI

`src/components/ui/` has no Slider. Spec requires new form fields to be shadcn: `npx shadcn@latest add slider`. Do not use a raw `<input type="range">`.
