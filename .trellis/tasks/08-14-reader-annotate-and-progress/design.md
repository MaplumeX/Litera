# Design: bookmarks, highlights, and progress jump

Parent design. Children own implementation detail; this file is boundaries, contracts, and integration.

## Architecture

```
App.tsx
  header: [←] title  [TOC][标注][Aa][chat]
  ReaderProgressBar   ← child progress-scrubber (always on)
  body: overlay TOC | overlay Annotations | ReaderView | Chat

ReaderView
  foliate-view + selection floating actions
  relocate → fraction/cfi/label
  create-overlay / draw-annotation → paint highlights

Rust LibraryStore
  library.json          unchanged (no annotation fields)
  books/<id>/annotations.json   ← child bookmarks-highlights
```

Two children, little shared code:

| Child | Layer | Persistence |
|---|---|---|
| `08-14-reader-progress-scrubber` | `App.tsx` + small progress component | none (uses existing `progress.fraction`) |
| `08-14-reader-bookmarks-highlights` | ReaderView, new drawer, new Tauri commands | `books/<id>/annotations.json` |

## Contracts

### Progress scrubber

- Input: `fraction` (0–1), `label` from existing `progress`.
- Output: `readerRef.goToFraction(frac)` on pointer click/drag.
- Relocate already updates `progress`; no new IPC.

### Annotations file

Path: `<app_data>/books/<bookId>/annotations.json`. Not on `BookRecord`. Missing file = empty lists.

Shape and commands: `research/annotation-persistence.md`. Full-snapshot `save_annotations`. Overwrite keeps the file; delete book removes the directory.

### Foliate locators

From `research/foliate-annotations.md`:

- Bookmark = `relocate.detail.cfi` + `fraction` + optional `tocItem.label`. Jump: `goTo(cfi)`, fallback `goToFraction`.
- Highlight = `view.getCFI(index, iframeRange)` + excerpt. Paint: `create-overlay` → `addAnnotation({ value: cfi })` → `draw-annotation` → `Overlayer.highlight` with one fixed color.
- Selection CFI and “问 agent” text must use the chapter iframe `doc.getSelection()`, not `window.getSelection()`.

## Integration

- Bookmark / highlight / TOC / scrubber jumps all go through foliate; one `relocate` updates the progress bar.
- Left overlays are exclusive: TOC and 标注 never both open.
- `annotationsVisible` is process memory only, same as `tocVisible`.
- Opening 标注 does not remount `ReaderView`.
- Persist failures for annotations use the same visible banner pattern as `update_reading_state` (`PersistenceErrorBanner`).

## Compatibility

- Do not add keys to `library.json` / `BookRecord` (`deny_unknown_fields`).
- Do not bump `library.json` `schemaVersion`.
- Old app ignores `annotations.json`; new app treats missing file as empty.
- Frontend spec today forbids a reader progress bar. Implementing the scrubber child **must** update `component-guidelines.md` and `state-management.md` so the new chrome is the written rule.

## Rollback

- Progress child: delete the bar component and revert the two spec paragraphs.
- Annotations child: unused `annotations.json` is ignored; drop commands + UI. No library.json migration.

## Out of design

Notes, colors, search, sidecar, exporting.
