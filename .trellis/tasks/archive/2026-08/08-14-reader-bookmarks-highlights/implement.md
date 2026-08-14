# Implement: reader bookmarks and highlights

## Checklist

1. `git submodule update --init src/foliate-js` if `view.js` is missing.
2. Rust: `AnnotationsFile` types; `get_annotations` / `save_annotations`; register in `lib.rs`. Missing file = empty. Tests: missing, round-trip, corrupt, unknown field, fraction bounds, delete book removes file (directory trash), overwrite keeps file.
3. TS types in `src/types/library.ts`. Do not add fields to `BookRecord`.
4. `foliate-js.d.ts`: `getCFI`, `addAnnotation`, `deleteAnnotation`, `goTo`, `Overlayer`.
5. `ReaderView`: iframe `selectionchange`; two floating actions; `create-overlay` / `draw-annotation`; handle methods from design.
6. `AnnotationsSidebar` + `App` toolbar / exclusive overlay / load-save snapshot / persist error banner.
7. i18n zh-CN + en. Tests for drawer, save payload, selection actions, ReaderView handle if practical.
8. Spec: `database-guidelines.md` layout; `tauri-commands.md` new commands; frontend chrome for 标注 drawer.
9. `npm test` && `npm run build`. Rust library tests for the new commands.

## Validation

```bash
git submodule update --init src/foliate-js
npm test
npm run build
cd src-tauri && cargo test library
```

## Risky files / rollback

- `src-tauri/src/library.rs` — keep `BookRecord` closed; new file only.
- `src/components/ReaderView.tsx` — do not remount on drawer toggle.
- If blocked: revert UI + commands; `annotations.json` can stay on disk.

## Do not

- Notes, colors, export, click-to-edit highlight.
- `update_reading_state` overload.
- WebView filesystem access.
- Start the parent task.
