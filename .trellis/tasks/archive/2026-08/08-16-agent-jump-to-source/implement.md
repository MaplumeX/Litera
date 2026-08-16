# Implement: click-to-source citations

## Checklist

1. Add `src/lib/tool-citations.ts` + tests for search hits, read_chapter, list_annotations, wrapped `{content:[text]}`, bad JSON, missing fields.
2. Add `LiteraAgentRuntime.resolveChapterHref(chapterIndex)` (worker TOC, book gate). Unit test with a fake `BookContentPort`.
3. `ToolCallCard` accepts `onOpenCitation` and renders citation rows; keep expand → raw JSON.
4. Thread the callback: `AssistantMessage` → `ChatPanel` prop `onOpenCitation`.
5. `App.tsx`: expand book if collapsed, close TOC/annotation drawers, CFI via `jumpToAnnotation`, chapter via `resolveChapterHref` + `goToChapterHref`.
6. i18n keys for row labels / aria (both catalogs).
7. Component tests: click a search row calls `onOpenCitation` with `{ kind: "chapter", chapterIndex }`; click a highlight row sends `{ kind: "cfi", cfi }`.

## Validation

```bash
npx vitest run src/lib/tool-citations.test.ts src/components/chat/AssistantMessage.test.tsx src/agent/runtime/embedded-runtime.test.ts
npx tsc --noEmit
```

Also run the App annotation / reader-mode tests if `App.tsx` jump wiring is covered there.

## Risky files

- `App.tsx` — reuse `jumpToAnnotation` / `goToChapterHref`; do not add a second CFI path.
- `ToolCallCard` — keep unknown tools unchanged.

## Rollback

Revert the frontend/runtime-resolver commit. No data migration.

## Follow-up before `task.py start`

- [x] Child 1 (`list_annotations`) implemented or at least its JSON contract frozen in parent `design.md`
- [x] `prd.md` / `design.md` / `implement.md` / jsonl
- [ ] User approved the parent planning summary
