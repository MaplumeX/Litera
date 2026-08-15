# Design: desktop reader layout polish

## Boundaries

This task only restyles and rearranges reader chrome that `App` already owns.

| In | Out |
|---|---|
| `src/App.tsx` reader header + book-cell chrome | Library view, settings dialog, chat bubbles |
| `src/components/ReaderProgressBar.tsx` + `src/lib/reader-progress.ts` | `src/foliate-js/**` edits |
| `src/components/TocSidebar.tsx`, `AnnotationsSidebar.tsx` | Persistence schema, `preferences.json` |
| `ReaderView` handle surface (read-only foliate APIs) | Remounting `ReaderView` / `ChatPanel` |
| Locale keys in `src/locales/{zh-CN,en}.ts` | New icon library / new layout engine |

Two modes still share one shell. Mode still only swaps `grid-template-areas` and column sizes.

## Target geometry

```
header:  [mac inset?] [←][TOC][标注]  title (drag)  [spacer drag]  [Aa] | [mode][reader: chat | agent: book]  [Win/Linux]
book:    [ ReaderView canvas ]
         [ ‹章  chapter    ====●==|==|====   42%  章› ]
chat:    unchanged ChatPanel (keeps its own sessions button)
```

Progress lives **only** in the book cell, both modes. Delete the reader-mode sibling that currently sits under the header (`src/App.tsx` ~904–910). Agent mode already mounts the bar inside the book cell; move it from above `ReaderView` to below.

## Contracts

### `ReaderViewHandle`

Add two read methods. Do not change `goToFraction` / `goToTocItem` / paging.

```ts
getSectionFractions(): number[]
// foliate-view.getSectionFractions(); empty array if the view is not open

previewLabelAt(fraction: number): string | undefined
// best-effort TOC label for a 0–1 fraction.
// Implementation: map fraction → spine index via the same section-fraction list,
// then foliate getProgressOf(index)?.tocItem?.label.
// If that path is awkward or missing, return undefined; the bar still shows percent.
```

Do not import `src/foliate-js/progress.js` into React. Talk to the already-mounted custom element.

### `ReaderProgressBar`

```ts
interface ReaderProgressBarProps {
  fraction: number            // committed book position (from relocate)
  chapterLabel: string        // committed chapter (from relocate)
  ticks?: number[]            // 0–1 section starts
  onSeek: (frac: number) => void
  onPrevChapter?: () => void
  onNextChapter?: () => void
  canPrevChapter?: boolean
  canNextChapter?: boolean
  previewLabelAt?: (frac: number) => string | undefined
}
```

Pointer rules:

1. Visual thumb/fill follow a local `draftFraction` while the pointer is down.
2. `pointerdown` that does not move past a small slop (~3px) and then `pointerup` → `onSeek(draft)`.
3. Drag past slop → update draft + preview only; `onSeek` on `pointerup` / `pointercancel` (cancel restores committed `fraction`, no seek).
4. `App` still wraps `onSeek` in `createLatestSerializedTaskController`.
5. `fractionFromPointer` stays the single mapper in `src/lib/reader-progress.ts`. Add helpers there for slop / nearest-tick only if they stay pure and unit-tested.

Hit target: the track row is ~36px tall; the painted track stays ~2px. Thumb ~10px, slightly larger while dragging (`transform`, not layout). Ticks are 1px marks on the track, `pointer-events-none`.

Prev/next chapter are `Button` `icon-sm` `ghost` with lucide chevrons and `useT()` aria-labels. They call `App` callbacks, not `onSeek`.

### Chapter walk

`App` already has `toc: TocItem[]` and `progress.chapterHref`. Flatten TOC in a small helper (`src/lib/toc-sidebar-width.ts` is the wrong home). Put `flattenToc(toc): { href: string; label: string }[]` next to other reader helpers, e.g. `src/lib/reader-progress.ts` or a tiny `src/lib/toc-items.ts`.

- Current index = first flattened item whose `href === chapterHref`, else `-1`.
- Prev / next = neighbor hrefs → existing `handleTocGoTo` without closing a drawer (do not reuse the drawer-closing path blindly; either a new `goToTocItem` wrapper or a flag).
- `canPrev` / `canNext` false when index is `-1` or at the ends, or `toc.length === 0`.

### Toolbar

Split the current single `flex … gap-1` cluster in `src/App.tsx` ~822–901:

- Left of title, after back: TOC + 标注 (same onClick as today).
- Right of spacer: `[Aa]` then a 1px `bg-border` rule then mode + chat-or-book.

Agent branch drops the `MessagesSquare` button. `ChatPanel` workspace header already toggles the rail.

Window drag regions stay on the title and the flex spacer only.

### Book canvas

Wrap `ReaderView` (the `relative min-h-0 flex-1` host) with a one-step surface, not a card shadow:

- `bg-muted/40` or `bg-sidebar` on the book cell, `bg-background` on the foliate host, ~12–16px inset **or** a 1px inner border.
- Inset must not change iframe hit testing: padding on the outer frame, `ReaderView` still `h-full w-full` inside the inner host.
- Selection toolbar is `fixed` to iframe rects; padding around the host is fine as long as `ReaderView` itself is not translated independently of the iframe.

Do not put warm paper tokens in `:root`. Do not touch `generateStylesCss`.

### Drawers

`TocSidebar` gains `currentHref?: string`. The matching row uses `bg-accent text-accent-foreground` (or `font-medium text-foreground`) instead of always `text-muted-foreground`.

Keep overlay geometry in `App` (`absolute inset-y-0 left-0`, backdrop, Esc, resize handle, `w-56` for 标注). Polish is padding, header row, and current-chapter contrast — not a new drawer system.

## Data flow

```
foliate relocate → App progress {fraction, label, chapterHref}
                → ReaderProgressBar committed fraction/label
                → TocSidebar currentHref

book ready      → App toc + readerRef.getSectionFractions()
                → ticks prop

pointerup seek  → App seekProgress → readerRef.goToFraction
                → relocate updates committed state

prev/next chap  → flatten(toc) + chapterHref → readerRef.goToTocItem
```

No new `localStorage` keys. No `preferences.json` fields. Drawer / chat / book collapse flags stay process-only.

## Compatibility

- Tests that assume the scrubber is a header sibling must look inside `reader-book-cell` instead (`src/App.reader-mode.test.tsx`, `src/App.annotations.test.tsx` if they query layout).
- `ReaderProgressBar.test.tsx` must cover draft-vs-commit, preview, disabled chapter buttons, and tick rendering.
- Header tests key off `aria-label`s (`目录`, `返回书库`, …). Moving buttons does not change those names; Agent tests that click a header「显示会话列表」must switch to the chat-panel sessions button.
- `component-guidelines.md` "reader chrome is reading-first" layout ASCII and the "progress under the header" / "Bookmark button sits between TOC and Aa" sentences must be updated in Phase 3.3 (same commit batch). Until then implement against this design.

## Tradeoffs

| Choice | Why | Rejected |
|---|---|---|
| Section ticks via `getSectionFractions` | Already on the view; same as Foliate | Resolving every TOC href to a fraction (async, extra API) |
| Seek on release, not on move | Current live seek lags and feels blind | Foliate's `input` live-seek |
| TOC walk for 上一章/下一章 | Matches user-facing chapters | Walking spine sections |
| Drop header sessions | Duplicate of `ChatPanel` | Keeping two toggles |
| Subtle canvas, not warm paper | Last refresh locked cool chrome | Whole-window sepia / bone |

## Rollback

Revert the chrome files listed above. No disk format to migrate. If `getSectionFractions` is missing on a not-yet-open view, ticks are `[]` and the bar still seeks.
