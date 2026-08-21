# Design: highlight colors, notes, and in-page editor

## Boundaries

| Piece | Owns |
|---|---|
| `src-tauri/src/library.rs` | `HighlightRecord` optional `color` / `note`; validate closed color ids and note byte cap; keep `schemaVersion: 1` |
| `src/types/library.ts` | matching TS types |
| `src/lib/annotations.ts` | default color, last-used color (module state), create/update helpers, note truncation |
| `src/components/ReaderView.tsx` | `show-annotation`, suppress paging, per-highlight draw color, host editor anchor |
| `src/components/HighlightEditor.tsx` (new) | color dots, note field, delete — host chrome, not iframe |
| `src/components/AnnotationsSidebar.tsx` | swatch + note excerpt; jump/delete unchanged |
| `src/App.tsx` | snapshot mutate + existing `save_annotations` path |
| `src/agent/runtime/embedded-runtime.ts` | `list_annotations` maps `color` + optional `note` |
| `src/locales/*` | new strings |

Do not add `BookRecord` keys. Do not bump library or annotations `schemaVersion`. Do not add WebView `fs` permission. Do not patch foliate-js.

## Data contract

```
HighlightRecord {
  id, cfi, excerpt, createdAt,
  color?: HighlightColor,  // omit = yellow
  note?: string            // omit / empty = no note
}

HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange"
```

Default `"yellow"` maps to the current paint `#fbbf24`. Other ids map to a closed hex table in `src/lib/annotations.ts` (one source of truth for paint, sidebar swatch, editor dots). Persist the **id**, not the hex.

`schemaVersion` stays `1`. `#[serde(default, skip_serializing_if = "Option::is_none")]` on both new fields. Old files without them load. Unknown `color` on save → `InvalidInput`; on load → `StorageCorrupt`. Note cap = `MAX_LABEL_BYTES` (4KiB); empty note is stored as omitted, not `""`.

Frontend always writes `color` on new/updated highlights. Untouched old highlights in a full snapshot may still omit `color`.

Last-used color: module variable in `annotations.ts`, process-only. Editor color click updates it. New highlight reads it, else `"yellow"`. App restart resets.

## Foliate / paging

Existing path stays: `create-overlay` → `addAnnotation({ value: cfi })` → `draw-annotation` → `Overlayer.highlight({ color })`.

Change: `addAnnotation` / `draw-annotation` must carry the record's resolved color. Pass `{ value: cfi, color: hex }` so `handleDrawAnnotation` uses `annotation.color` instead of the global constant. Color change = `deleteAnnotation` + `addAnnotation` with the new color (same CFI key).

Click-to-edit: listen `show-annotation` `{ value }` (CFI). Map CFI → highlight in the current snapshot. Open `HighlightEditor` at the event range's viewport box (same host-overlay idea as `SelectionToolbar`). Ignore TTS overlay keys.

Paging conflict: iframe `pointerup` currently pages on left/right thirds. A highlight hit must not page.

- On `show-annotation`, mark the click consumed before `bindPointerPaging`'s `pointerup` turns the page, **or** extend `bindPointerPaging` with a `shouldIgnore(event)` that is true when the pointer landed on an annotation range.
- Inspect `src/foliate-js/view.js` at implement time for event order (`show-annotation` vs host `pointerup`). Prefer ignoring paging when `show-annotation` already fired for this gesture.
- `shouldIgnorePagingTarget` is the wrong hook: overlay SVG is `pointer-events: none`, the target is ordinary text.

Blank click / Esc / new selection closes the editor, same as clearing `SelectionToolbar`.

## UI

`HighlightEditor` is host chrome over the book (fixed, compact), not a `Dialog`. Color = 5 `button` dots with `aria-label`. Note = existing shadcn `Input` or add `textarea` via shadcn if a single-line input is too tight; do not invent a native form. Delete uses the same ghost icon-button pattern as the sidebar.

Sidebar highlight row: a color swatch + `line-clamp-2` excerpt; if `note` exists, a second clamped line. Delete and jump stay. Do not put the editor form in the drawer.

Selection toolbar unchanged: 「高亮」「问 agent」.

## Agent

`list_annotations` highlight map becomes `{ id, cfi, excerpt, createdAt, color, note? }`. `color` is always present (missing record → `"yellow"`). `note` omitted when unset/blank. Bookmarks unchanged. Still `get_annotations` only, `bookCall` gated.

## Data flow

```
open book → get_annotations → ReaderView paints each cfi with resolved color

select → 高亮
  → createHighlight({ cfi, excerpt, color: lastUsed || yellow })
  → append → save_annotations → paint

click painted highlight
  → show-annotation(cfi) → suppress paging → HighlightEditor

change color / note / delete
  → update snapshot → save_annotations
  → color: repaint; delete: deleteAnnotation; note: sidebar text only
```

## Compatibility / rollback

- New app + old file: OK (optional fields).
- Old app + new file with `color`/`note`: `StorageCorrupt` (same `deny_unknown_fields` rule as other optional keys). Acceptable for this early schema; do not dual-write two files.
- Rollback: revert UI + types; leftover `color`/`note` on disk will fail old builds until the file is rewritten without those keys. No migration script.

## Spec follow-up (Phase 3.3)

Update “single-color / no notes” wording in `database-guidelines.md`, `tauri-commands.md`, `type-safety.md`, `quality-guidelines.md` (`list_annotations` payload), and frontend component/state notes if they mention 单色.
