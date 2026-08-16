# Implement: annotations tool + click-to-source

Parent is planning/integration only. Do **not** `task.py start` this directory.

## Order

1. `08-16-agent-read-annotations` — tool + tests + prompt copy.
2. `08-16-agent-jump-to-source` — parse tool results, wire `onOpenCitation` in `App`.
3. Parent integration review against parent AC1–AC6, then archive children and parent.

Child 2 may parse search/read without child 1, but annotation rows need the child 1 payload. Do them in this order so one jump pass covers all three tools.

## Validation (after both children)

```bash
npx vitest run
npx tsc --noEmit
```

Optional if Rust was touched (it should not be):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

## Follow-up before any `task.py start`

- [x] Parent and both children have `prd.md` / `design.md` / `implement.md`
- [x] `implement.jsonl` / `check.jsonl` have real spec entries
- [ ] User approved this planning summary
- After approval: `task.py start` **`08-16-agent-read-annotations`**, not the parent
