# Implement: desktop reader layout polish

## Checklist

1. **Helpers**
   - Extend `src/lib/reader-progress.ts` with any pure draft/slop helpers; keep `fractionFromPointer`.
   - Add `flattenToc` (href + label) in a small helper module.
   - Unit-test both.

2. **`ReaderView` handle**
   - Expose `getSectionFractions()` and a best-effort `previewLabelAt(fraction)`.
   - Do not edit `src/foliate-js`.
   - Update the mock handle in `App.reader-mode.test.tsx` and `App.annotations.test.tsx`.

3. **`ReaderProgressBar`**
   - New layout: prev chapter, label, track+thumb+ticks, percent, next chapter.
   - Local draft fraction while dragging; seek on click / pointerup.
   - Preview string while dragging or hovering the track.
   - Rewrite `src/components/ReaderProgressBar.test.tsx` for the new pointer contract.

4. **`App` chrome**
   - Move TOC + 标注 buttons to the left of the title (after back).
   - Right cluster: Aa | mode + chat-or-book. Remove Agent header sessions button.
   - Mount a single `ReaderProgressBar` at the bottom of `reader-book-cell` in both modes. Delete the header-sibling instance.
   - Wire ticks from `getSectionFractions` after `onBookReady` / book change (clear ticks when `fileData` clears).
   - Wire prev/next chapter from flattened TOC + `progress.chapterHref`. Jump must not depend on closing a drawer.

5. **Canvas + drawers**
   - One-step surface / inset around `ReaderView` only.
   - `TocSidebar` current-chapter highlight via `currentHref={progress.chapterHref}`.
   - Tighten drawer header/list spacing. Do not change overlay geometry or persist flags.

6. **i18n**
   - Add keys for prev/next chapter and progress preview/aria in `zh-CN.ts` and `en.ts`.
   - Existing `npm test` i18n parity test must stay green.

7. **Tests + build**
   - Update App tests that assume header-under scrubber or header sessions in Agent mode.
   - `npm test`
   - `npm run build`

## Validation

```bash
npm test
npm run build
```

Manual (after implement, before calling the work done): open a book in the desktop app, check reader and Agent modes, drag the scrubber, click ticks, prev/next chapter at ends, TOC current row, chat still opens, Agent sessions still toggle from the chat header.

## Risky files / rollback

| File | Risk |
|---|---|
| `src/App.tsx` | Header, progress mount point, and drawer wiring all live here. One bad branch remounts the reader. |
| `src/components/ReaderView.tsx` | Handle additions only. A mistaken effect re-open would break paging. |
| `src/components/ReaderProgressBar.tsx` | Pointer capture + draft state; easy to regress seek or page-turn keys (do not listen for arrows here). |

Rollback: git revert the chrome files. No schema.

## Before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md` written
- [x] Research note on Foliate/Readest ticks
- [x] `implement.jsonl` and `check.jsonl` have real spec/research entries
- [ ] User approved this planning summary
