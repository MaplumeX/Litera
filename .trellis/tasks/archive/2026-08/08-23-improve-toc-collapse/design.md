# Design: TOC nested collapse

## Approach

Keep TOC as the existing overlay drawer. Add process-only expand state in `App` (above the remount) and render collapse in `TocSidebar`. Tree-key helpers live next to `flattenToc` in `src/lib/toc-items.ts`.

Do **not** persist expand state. Do **not** change `{tocVisible && <TocSidebar />}` mount. Do **not** change `handleTocGoTo` close-on-jump.

## State

`App` holds `tocExpanded: string[]` (list of expanded node keys).

| Event | Next `tocExpanded` |
|---|---|
| Open book / `setToc([])` / back to library | `[]` then first real TOC applies R5 |
| `handleBookReady` / `setToc(bookToc)` | `ancestorKeysForHref(toc, currentHref)` (R5) |
| `currentHref` changes | union those ancestor keys into the existing list (R6) |
| Chevron toggle | add or remove that node key |
| Expand-all | `collapsibleKeys(toc)` |
| Collapse-all | `ancestorKeysForHref(toc, currentHref)` (R8 = R5) |
| Drawer close / reopen | unchanged (state lives in `App`) |

`currentHref` is `progress.chapterHref`. Missing or unmatched href → ancestor keys `[]` (all collapsed).

Pass `expanded`, `onToggle`, `onExpandAll`, `onCollapseAll` into `TocSidebar`. Do not keep a second copy inside the sidebar.

## Node keys

Identify rows by sibling-index path, not `href`.

```ts
tocPathKey([0, 2, 1]) === "0.2.1"
```

EPUB TOCs can repeat hrefs and omit hrefs. Path keys stay unique for a given `toc` tree. Book switch replaces `toc` and resets the list.

A row is collapsible iff `item.subitems?.length > 0`. `ancestorKeysForHref` returns collapsible **ancestors** of every `item.href === currentHref` match (DFS), not the matching row itself. The current parent row can stay collapsed and still be visible.

Nested keys under a collapsed parent stay in `tocExpanded` but are not rendered (R2).

## Sidebar UI

Do not nest `<button>` inside `<button>`. Each row is a flex container:

- Optional `Button` `size="icon-xs"` `variant="ghost"` chevron (`ChevronRight` collapsed, `ChevronDown` expanded) with `aria-expanded` and `t("toc.expand")` / `t("toc.collapse")`.
- Leaf rows render a `w-6` spacer so labels align.
- Title is a separate control. Non-empty href: existing jump styles, `onGoTo(href)` (App still closes the drawer). Empty href: not a navigation control; do not call `onGoTo`.
- Current highlight (`bg-accent`) applies to the whole row, matching today’s “current row” contract. Auto-center still uses the list `getBoundingClientRect` rule on the row.

Title bar stays `flex h-12 items-center border-b px-3 text-sm font-medium`. Right-side expand-all / collapse-all are `icon-xs` ghost buttons with `t("toc.expandAll")` / `t("toc.collapseAll")` aria-labels. Do not add `py-3`. Do not change drawer width, backdrop, or Esc.

Children render only when the parent key is in `expanded`.

## i18n

Add the same keys to `src/locales/zh-CN.ts` and `src/locales/en.ts`:

| Key | zh-CN | en |
|---|---|---|
| `toc.expandAll` | 全部展开 | Expand all |
| `toc.collapseAll` | 全部折叠 | Collapse all |
| `toc.expand` | 展开 | Expand |
| `toc.collapse` | 折叠 | Collapse |

Existing `toc.title` / `toc.empty` stay.

## What stays put

- Overlay drawer, remount-on-open, width `localStorage`, process-only `tocVisible`.
- Flattened prev/next via `flattenToc` / `chapterNavAt`.
- Agent book-cell expand-on-TOC-open.
- No React Context, no `preferences.json` field, no `update_reading_state` field.

## Trade-off

Lifting expand state to `App` vs hiding the drawer without unmounting: remount is already the documented reason current-row centering runs on open. Changing mount would also keep scroll position and is a larger chrome change. Lifted `string[]` is the smaller contract.

Path keys vs href keys: hrefs collide and can be empty; paths do not.
