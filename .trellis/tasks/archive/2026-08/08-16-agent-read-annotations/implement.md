# Implement: list_annotations

## Checklist

1. Add `loadAnnotations` to `LiteraAgentRuntime` options; default `invoke<AnnotationsFile>("get_annotations", { bookId })`.
2. Register `list_annotations` in `tools()` next to the four book tools. `bookCall` then `loadAnnotations`. JSON text via existing `result()`.
3. Update `SYSTEM_PROMPT` to mention the tool for reader marks only.
4. Test: fake `loadAnnotations` returns one bookmark + one highlight; prompt a faux tool call; persisted `toolResult` JSON has those fields. Second test: empty file → empty arrays. Third: `bookId` switch rejects stale execute.
5. Do not touch `ToolCallCard`, Rust, or `save_annotations`.

## Validation

```bash
npx vitest run src/agent/runtime/embedded-runtime.test.ts
npx tsc --noEmit
```

## Risky files

- `src/agent/runtime/embedded-runtime.ts` — keep tool results as JSON text; do not change prompt persistence order.

## Rollback

Revert the runtime commit. In-flight sessions lose the tool on next Agent rebuild (`invalidateConfig` / new book).

## Follow-up before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md`
- [x] jsonl manifests
- [ ] User approved the parent planning summary
