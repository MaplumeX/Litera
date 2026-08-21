# Implement: highlight colors, notes, and in-page editor

## Checklist

1. **Color + note helpers** — `src/lib/annotations.ts` + `src/types/library.ts`: closed `HighlightColor` union, hex table, default `"yellow"`, process last-used color, `createHighlight` stamps color, update note/color, truncate note. Tests in `annotations.test.ts` (including old records without the new fields).
2. **Rust contract** — `HighlightRecord` optional `color` / `note`; validate closed ids and 4KiB note; keep `schemaVersion: 1`. Tests: old file loads; round-trip with both fields; unknown color rejected; note cap; empty note omitted.
3. **Paint by color** — `ReaderView` `draw-annotation` uses the annotation color; `addAnnotation({ value, color })`. Changing color repaints the same CFI.
4. **Click editor + no paging** — listen `show-annotation`; open `HighlightEditor`; suppress the same gesture’s left/right page turn. Esc / blank click / new selection closes it. Inspect `foliate-js/view.js` for event order before wiring.
5. **Sidebar** — swatch + note summary; jump/delete/close-drawer unchanged.
6. **App snapshot** — add/update/delete still go through existing `commitAnnotations` / `save_annotations`. Do not save until `get_annotations` succeeded.
7. **Agent** — `list_annotations` includes `color` and optional `note`. Update `embedded-runtime.test.ts`. Tool stays read-only.
8. **i18n** — zh-CN + en for editor, color names, note placeholder, delete.
9. **Tests** — `App.annotations.test.tsx`, `AnnotationsSidebar.test.tsx`, new editor tests, ReaderView paging-vs-highlight if practical.
10. Do **not** run spec updates here; those are Phase 3.3 after check.

## Validation

```bash
npm test
npm run build
cd src-tauri && cargo test library
```

Also: `embedded-runtime` tests covering `list_annotations` payload with `color` / `note`.

## Risky files / rollback

- `src/components/ReaderView.tsx` — paging vs `show-annotation` order. If click-to-edit pages the book, stop and fix before adding more UI.
- `src-tauri/src/library.rs` — do not bump `ANNOTATIONS_SCHEMA_VERSION`; optional fields only.
- `src/agent/runtime/embedded-runtime.ts` — mapping only; no `save_annotations`.

Rollback: revert the feature commits; on-disk files with extra keys are only a problem for older builds.

## Do not

- Export, bookmark notes/colors, custom hex, last-used color persistence.
- Restore tool-result jump.
- Agent write tools.
- Remount `ReaderView` when opening the editor.
- Dual schema versions or a migration rewriter.
