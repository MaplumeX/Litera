# Design: annotations tool + click-to-source

Parent contract only. Child tasks own file-level design.

## Boundaries

| Layer | Parent rule |
|---|---|
| Rust | No new commands. Reuse `get_annotations`. Never call `save_annotations` from the agent. |
| Runtime | Add one model tool `list_annotations`. Do not add `open_in_reader`. Do not inject annotations into `bookSnapshot` / `readingContext`. |
| Book worker | Unchanged. Annotations are not EPUB text. |
| Chat UI | Child 2 makes known tool results clickable. Child 1 may still render as JSON until child 2 lands. |
| Reader | Reuse `goToTocItem` / `goToCfi` / `goToFraction`. No new foliate API. |

## Cross-child contracts

### `list_annotations` JSON (model + UI)

Text payload (same pattern as other tools: `result(JSON.stringify(...))`):

```json
{
  "bookmarks": [
    { "id": "…", "cfi": "epubcfi(…)", "fraction": 0.12, "createdAt": "…", "label": "Chapter 2" }
  ],
  "highlights": [
    { "id": "…", "cfi": "epubcfi(…)", "excerpt": "…", "createdAt": "…" }
  ]
}
```

Omit `label` when absent. Empty arrays are success.

### Citation (UI only, not a model tool)

```ts
type BookCitation =
  | { kind: "chapter"; chapterIndex: number }
  | { kind: "cfi"; cfi: string; fraction?: number };
```

- Search hit / read_chapter → `{ kind: "chapter", chapterIndex }`
- Annotation item → `{ kind: "cfi", cfi, fraction? }`

`chapterIndex` resolves through the **worker** TOC (`BookTocEntry.hrefs[0]`), never `flattenToc(readerToc)[i]`.

### What the model must not get

- A navigation tool
- TOC `hrefs` in new or existing book tools
- Annotation writes

## Data flow

```
list_annotations
  runtime bookCall(bookId)
  → invoke get_annotations({ bookId })
  → JSON text tool result
  → tool_end → ToolCallCard

user clicks a citation
  ChatPanel onOpenCitation(citation)
  → App: expand book if needed, close overlays
  → chapter: runtime.resolveChapterHref(index) → goToTocItem
  → cfi: jumpToAnnotation(cfi, fraction)
```

## Compatibility

- Old `search_in_book` / `read_chapter` transcripts stay valid click targets (they already carry `chapterIndex`).
- Old sessions have no `list_annotations` rows.
- No session or `annotations.json` migration.

## Rollback

Revert the two child commits independently. Child 2 revert leaves the list tool as JSON-only cards. Child 1 revert leaves search/read click-to-chapter intact if child 2 already shipped.

## Trade-offs

- CFI appears in the model-visible JSON so historical cards stay clickable without looking up live App state. Token cost is small next to excerpts.
- Chapter-start jumps for search/read avoid offset→CFI work. Precision is worse on long chapters; accepted (D4).
