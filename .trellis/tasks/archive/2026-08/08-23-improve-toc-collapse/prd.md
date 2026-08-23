# Improve TOC nested heading collapse

## Goal

阅读页目录可折叠。长目录默认只展开当前章节路径；用户能用箭头收起分支、用标题栏一次展开或折到当前路径。同一本书关掉再打开目录时保留折叠状态，换书重置。

## Background

- `TocSidebar` always renders the full nested `subitems` tree. There is no expand control. Clicking a row calls `onGoTo(item.href)`.
- `App.handleTocGoTo` jumps via `goToTocItem` and closes the drawer. Empty `href` still reaches `view.goTo(href)` today (`ReaderView.goToTocItem`).
- The drawer remounts on every open (`{tocVisible && <TocSidebar />}` in `src/App.tsx`). Expand state must live above that remount.
- Current-row highlight and auto-center already exist (`item.href === currentHref`). Spec: frontend `component-guidelines.md` “TOC current row stays in the list viewport”.
- TOC is an overlay drawer over `ReaderView` (backdrop / Esc / chapter click close). Width persists in `localStorage` `toc-sidebar-width`. `tocVisible` is process-only (`state-management.md`).
- Flattened prev/next (`flattenToc` / `chapterNavAt` in `src/lib/toc-items.ts`) must ignore sidebar expand state.
- Reader and Agent share one `TocSidebar`. Opening TOC while the Agent book cell is collapsed still expands the book first.
- Prior TOC tasks covered resize and current-row centering, not nested collapse.

## Requirements

- **R1** A row with `subitems.length > 0` shows a collapse chevron. Leaf rows have no chevron and keep a single click-to-jump target.
- **R2** Collapsing a parent hides all descendants until that parent is expanded. Nested expand flags under a collapsed parent are kept, not discarded.
- **R3** Clicking the title (not the chevron) with a non-empty href still calls `onGoTo(href)` and closes the drawer. Chevron click toggles expand only: no jump, drawer stays open.
- **R4** A parent with empty `href` does not call `goTo("")`. Title click is a no-op for navigation; the chevron still toggles.
- **R5** On first open for a book (no expand state yet), expand only the ancestor chain of `currentHref`. If `currentHref` is missing or matches nothing, all collapsible rows start collapsed.
- **R6** When `currentHref` changes to a matching row, expand that row’s ancestors so the current row is visible. Do not auto-collapse branches the user already expanded.
- **R7** Expand state is process-only for the open book. Closing and reopening the drawer keeps it. Switching books or returning to the library clears it. Do not persist it.
- **R8** The TOC title row has expand-all and collapse-all. Expand-all expands every collapsible row. Collapse-all sets expanded keys to the current chapter’s ancestors (same as R5).
- **R9** Visible current-row highlight and auto-center keep the existing list-viewport contract. Overlay chrome is unchanged: overlay, Esc, backdrop, resizable width, process-only `tocVisible`. Prev/next chapter still walks the flattened TOC.

## Acceptance Criteria

- [ ] **AC1** (R1, R2, R3) A parent row shows a chevron; a leaf row does not. Clicking the chevron hides/shows descendants and does not jump or close the drawer.
- [ ] **AC2** (R3) Clicking a title with a non-empty href jumps to that href and closes the drawer, same as today.
- [ ] **AC3** (R5) First open of a book’s TOC shows only the current chapter path expanded; other branches are collapsed. No matching `currentHref` → all collapsed.
- [ ] **AC4** (R7) After the user expands extra branches, closing and reopening the drawer on the same book keeps those expansions. Switching books or returning to the library resets to R5.
- [ ] **AC5** (R6) When the current chapter moves into a collapsed branch, that branch’s ancestors expand so the current row can highlight and center. Extra expanded branches stay expanded.
- [ ] **AC6** (R8) Expand-all reveals the full tree. Collapse-all leaves only the current chapter path expanded (or all collapsed if there is no match).
- [ ] **AC7** (R4) Empty-href parents never invoke `goTo("")`.
- [ ] **AC8** `npm test` and `npm run build` pass. New tests cover chevron vs title click, first-open current-path, drawer remount persistence, book-switch reset, auto-expand on `currentHref` change, expand-all / collapse-all, and empty href.

## Out of scope

- Search / filter in the TOC.
- Keyboard tree navigation beyond existing Esc.
- Changing TOC from overlay drawer to a permanent column.
- Changing flattened prev/next chapter walking.
- Persisting expand state in `localStorage`, `preferences.json`, or `update_reading_state`.
- Annotations sidebar.
