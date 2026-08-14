# Implement: unify chapter coordinates

## Checklist

1. Add pure helpers (canonical href, `hrefMatches`, `findChapterByHref`, `assignChapterOwners`, `mergeOwnedChapters`) in `sidecar/book-text.ts` or a sibling `sidecar/chapter-ownership.ts` imported by tests without WASM.
2. Change `sidecar/book.ts` `loadBook` / `getToc` / `searchInBook` / metadata chapter count to the owned list. Resolve TOC hrefs against the nav/ncx directory. Keep internal `href` / `hrefs`; strip before tool/snapshot output.
3. Unit tests: cover file not in TOC; two spine files under one TOC href; nested-looking paths that must not suffix-match (`part0010.html` vs `0.html`); empty TOC fallback; lookup by TOC href and by spine id.
4. `PromptContext`: replace `chapterIndex` with `chapterHref` in `sidecar/protocol.ts`, `src-tauri/src/sidecar_protocol.rs`, and the frontend invoke payload. Update protocol unit tests on both sides.
5. `sidecar/index.ts` aside: resolve href → title + chapterNumber; never print a bare spine integer.
6. `ReaderView`: on relocate/selection, record `tocItem.href ?? sections[index].id`. Thread it through `App` → `ChatPanel` → `prompt` / `editPrompt` / `AgentMessage` (`src/types/agent.ts`, `use-agent-bridge`, tests). Stop sending spine `chapterIndex`.
7. Run `cd sidecar && npm test`. Run frontend tests that touch the agent bridge / protocol types. Update snapshot tests if `totalChapters` meaning is asserted.

## Validation

```bash
cd sidecar && npm test
```

```bash
npx vitest run src/lib/use-agent-bridge.test.ts src/lib/agent-reducer.test.ts
```

If protocol Rust tests are in-crate:

```bash
cd src-tauri && cargo test sidecar_protocol --offline
```

Optional after a sidecar rebuild: `cd sidecar && npm run build && npm run smoke`.

## Risky files

- `sidecar/book.ts` — ownership bugs mis-index every tool; keep FTS rowid aligned with owned index.
- `sidecar/protocol.ts` + `sidecar_protocol.rs` — `deny_unknown_fields` on `PromptContext`; one side updated alone breaks every prompt.
- `ReaderView.tsx` — `tocItem` type today omits `href`; confirm foliate actually provides it (`view.js` `#onRelocate`).

## Rollback

Git revert. No library/session migration. Confirm both protocol ends still agree on `PromptContext`.

## Follow-up before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md` written
- [x] Research note at `research/chapter-ownership.md`
- [x] `implement.jsonl` / `check.jsonl` have real spec + research entries
