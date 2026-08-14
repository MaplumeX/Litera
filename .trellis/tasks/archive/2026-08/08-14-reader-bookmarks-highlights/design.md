# Design: reader bookmarks and highlights

## Boundaries

| Piece | Owns |
|---|---|
| `src-tauri/src/library.rs` | `get_annotations` / `save_annotations`; read/write `books/<id>/annotations.json` under `LibraryStore` |
| `src-tauri/src/lib.rs` | register the two commands |
| `src/types/library.ts` | TS types matching the JSON (not fields on `BookRecord`) |
| `src/components/ReaderView.tsx` | iframe selection, CFI, `create-overlay` / `draw-annotation`, handle API |
| `src/foliate-js.d.ts` | `getCFI`, `addAnnotation`, `deleteAnnotation`, `goTo`, `Overlayer` |
| `src/components/AnnotationsSidebar.tsx` (new) | drawer list + add-bookmark + delete |
| `src/App.tsx` | load/save snapshot, `annotationsVisible`, toolbar button, exclusive vs TOC |
| `src/locales/*` | new strings |

Do not touch sidecar. Do not add `BookRecord` keys. Do not add WebView `fs` permission.

Init `src/foliate-js` before coding.

## Persistence

See parent `research/annotation-persistence.md`.

```
get_annotations(bookId) → { schemaVersion, bookmarks, highlights }
save_annotations(bookId, data)  // full replace
```

- Missing file → empty lists, not corrupt.
- Invalid file / bad schemaVersion → `StorageCorrupt`.
- Atomic write, same helper as other library files.
- Validate: unique ids, CFI non-empty, bookmark fraction in 0..=1, excerpt/label byte caps.

Frontend keeps the snapshot in `App` state for the open book. Add/delete mutates local lists then `save_annotations` the whole object.

## Foliate

See parent `research/foliate-annotations.md`.

```
relocate.detail.cfi + fraction + tocItem.label  → new bookmark
iframe doc.getSelection() + view.getCFI(index, range) → new highlight
create-overlay { index } → addAnnotation for highlights in that section
draw-annotation → draw(Overlayer.highlight, { color: FIXED })
delete → deleteAnnotation({ value: cfi }) + drop from snapshot
jump → goTo(cfi); bookmark fallback goToFraction
```

Fixed highlight color is a renderer constant (theme-aware CSS-friendly, e.g. a single amber). Not persisted.

`ReaderViewHandle` grows: `getLocation()`, `getSelectionCfi()`, `addHighlight(cfi)`, `removeHighlight(cfi)`, `goToCfi(cfi)`. Persistence stays in App.

Bind `selectionchange` on each `load` iframe `doc` (same place paging is bound). Floating buttons stay in the host.

## UI

- Toolbar Bookmark icon between TOC and Aa. `variant="secondary"` when open.
- `annotationsVisible` in `App`, process-only. Opening it sets `tocVisible` false; opening TOC sets it false.
- Drawer chrome copies `TocSidebar` overlay (backdrop, left `w-56`, Esc).
- Two sections. Add-bookmark at top of bookmarks. Each row: label/excerpt + delete. Click row → goTo → close drawer.
- Selection overlay: two host buttons, 高亮 then 问 agent.

## Data flow

```
open book
  → get_annotations(bookId)
  → ReaderView create-overlay paints highlights

add bookmark
  → getLocation() from last relocate
  → append if cfi new → save_annotations

add highlight
  → getSelectionCfi() → addHighlight → append → save_annotations

delete
  → removeHighlight if highlight → filter list → save_annotations
```

## Compatibility

Old app: extra file ignored. New app: missing file empty. Overwrite keeps file. Delete trashes directory.

## Rollback

Remove commands + UI. Leftover `annotations.json` is ignored.
