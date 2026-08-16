# Design: click-to-source citations

## Boundaries

| Layer | Change |
|---|---|
| `src/lib/tool-citations.ts` (new) | Pure parse: tool name + result/params → `BookCitation[]` + labels. |
| `ToolCallCard` / `AssistantMessage` / `ChatPanel` | Render clickable rows; pass `onOpenCitation`. |
| `LiteraAgentRuntime` | Public `resolveChapterHref(chapterIndex)` from worker TOC `hrefs[0]`. No new model tool. |
| `App.tsx` | Implement the jump: expand book, close overlays, CFI vs chapter. |
| Locales | Button/row labels in `en.ts` / `zh-CN.ts`. |
| Rust / annotations schema | None. |

## Citation parse

Accept both live `tool_end` payloads and reloaded session strings.

1. If `result` is a string, use it.
2. If `result` is `{ content: [{ type: "text", text }] }`, use `text`.
3. Otherwise `JSON.stringify` is only for the existing raw `<pre>` fallback, not for parse.

Then `JSON.parse` the text.

| Tool | Rows |
|---|---|
| `search_in_book` | Each hit with numeric `chapterIndex` → chapter citation; label = `chapterTitle` or snippet |
| `read_chapter` | One row from result or params `chapterIndex` → chapter citation |
| `list_annotations` | Each bookmark/highlight with non-empty `cfi` → cfi citation |

Unknown tools, parse failures, and `isError` results: keep today's JSON `<pre>`, no buttons.

Do not parse assistant Markdown.

## Jump

```
onOpenCitation(citation)
  setBookCollapsed(false)   // agent mode
  closeOverlays()
  if citation.kind === "cfi":
    jumpToAnnotation(citation.cfi, citation.fraction)
  else:
    href = await embeddedAgentRuntime.resolveChapterHref(citation.chapterIndex)
    if href: goToChapterHref(href)
```

`resolveChapterHref` uses the open book's `book.toc()` and the same `bookId` gate as `bookCall`. Missing index → `undefined`, click is a no-op.

Do not use `flattenToc(toc)[chapterIndex]`.

## UI

Keep the existing collapsible header (tool name + params). When there are citations, show them below the header without requiring expand. Expand still reveals raw JSON for debugging.

Match current card chrome: 1px border, no shadow, `text-xs`. Rows are buttons with `line-clamp` on snippet/excerpt.

## Compatibility

- Historical search/read JSONL works because `chapterIndex` is already stored.
- `list_annotations` rows appear only after that tool exists.
- No protocol / event schema change.

## Rollback

Revert the UI + `resolveChapterHref`. The list tool remains callable; cards go back to JSON-only.
