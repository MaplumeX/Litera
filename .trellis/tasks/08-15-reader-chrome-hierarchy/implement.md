# Implement: tighten reader chrome hierarchy

## Checklist

1. **Titles**
   - `src/App.tsx` reader `h1`: `text-lg font-semibold` → `text-sm font-medium`.
   - `src/components/LibraryView.tsx` library `h1`: same change.
   - Keep drag region, truncate, `titlebarClassName()`.

2. **Book cell full-bleed**
   - In `src/App.tsx`, drop `bg-muted/40` from both `reader-book-cell` class strings.
   - Delete the `absolute inset-0 p-3` wrapper and the inner `bg-background` host.
   - Mount `ReaderView` directly in the existing `relative min-h-0 flex-1 overflow-hidden` stack (still only when `fileData` is set).
   - Leave overlay drawers and `ReaderProgressBar` as siblings of that stack. Do not move the scrubber.

3. **Split hairline**
   - Chat cell: add `border-l` when `readerMode === "reader"` and the chat cell is visible.
   - Book cell: add `border-l` when `readerMode === "agent"` and the book cell is visible.
   - Do not change resize-handle hit area or TOC drawer resize handle.

4. **Docked chat header**
   - `src/components/chat/ChatPanel.tsx`: docked header without `border-b`, title `font-medium`.
   - Workspace header unchanged (`border-b`, current title weight).
   - Do not touch session rail, messages, or `fillInput`.

5. **Drawer titles**
   - `TocSidebar` and `AnnotationsSidebar` title rows → `flex h-12 shrink-0 items-center border-b px-3 text-sm font-medium`.
   - Do not change overlay geometry or list item classes.

6. **Tests**
   - Assert reader + library titles use `text-sm font-medium` and not `text-lg font-semibold`.
   - Assert `reader-book-cell` has no `p-3` / `bg-muted/40`; `reader-view` is inside the flex-1 host; scrubber remains last child.
   - Assert `border-l` on the right-hand cell when the side pane is open, and absent when collapsed, in both modes.
   - Assert docked chat header has no `border-b`; workspace still has it.
   - Keep existing header button-order, drag-region, and progress ownership tests.

7. **Verify**
   - `npm test`
   - `npm run build`

## Validation

```bash
npm test
npm run build
```

Manual (after implement, before calling the work done): open a book in the desktop app, light and dark. Confirm no muted frame around the page, progress flush under the page, chat open shows one vertical hairline, docked chat has no second title bar rule, Agent mode hairline sits on the book, drawers still overlay the page.

## Risky files / rollback

| File | Risk |
|---|---|
| `src/App.tsx` | Wrapper deletion can remount `ReaderView` if the element tree is branched. Keep a single `ReaderView` in both modes. |
| `src/components/chat/ChatPanel.tsx` | Variant class split must not remount the panel or clear `fillInput`. |
| Tests that snapshot class strings | Brittle if they over-match Tailwind order. Prefer `toContain` / `not.toContain`. |

Rollback: revert the chrome files. No schema.

## Before `task.py start`

- [x] `prd.md` / `design.md` / `implement.md` written
- [x] `implement.jsonl` and `check.jsonl` have real spec entries
- [ ] User approved this planning summary
