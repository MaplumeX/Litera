# Design: tighten reader chrome hierarchy

## Boundaries

This task only restyles existing chrome. Layout ownership and data flow stay where they are.

| In | Out |
|---|---|
| `src/App.tsx` book-cell wrapper + side-pane `border-l` | `src/foliate-js/**` |
| Reader / library title classes | Progress pointer contract, TOC flatten, chapter walk |
| `ChatPanel` docked header chrome only | Chat bubbles, session rail behavior, Agent protocol |
| `TocSidebar` / `AnnotationsSidebar` title row padding | Drawer overlay geometry, resize persistence |
| Tests that pin chrome classes | `preferences.json`, `generateStylesCss`, icon library |

Two modes still share one shell. Mode still only swaps `grid-template-areas` and column sizes.

## Target geometry

```
header:  [mac inset?] [←][TOC][标注]  title (drag, text-sm/medium)  [spacer]  [Aa] | [mode][chat/book]  [Win/Linux]
book:    [ ReaderView full-bleed ]
         [ ‹章  chapter    ====●==|==|====   42%  章› ]   ← border-t only
chat:    [ optional border-l when this cell is the right column ]
         [ docked header: no border-b ]
```

## Contracts

### Book cell

Remove the current well:

```tsx
// delete
bg-muted/40
absolute inset-0 p-3
inner bg-background host
```

Keep the flex stack:

```
reader-book-cell
  relative min-h-0 flex-1 overflow-hidden    // ReaderView + overlay drawers
    ReaderView                               // already h-full w-full
    TOC / 标注 overlays (unchanged geometry)
  ReaderProgressBar                          // last child, keep border-t
```

`hidden` book cell keeps today's `hidden` attribute + non-`flex` class split. Drop `bg-muted/40` from both class strings.

Do not add a card radius or inner border. Do not put Geist into `generateStylesCss`.

### Split hairline

Columns are always `1fr ${sideWidth}%`. The side pane is the right column in both modes (reader: chat; agent: book).

Put `border-l` on the right-hand cell when it is visible:

- reader + chat open → chat cell `border-l`
- agent + book open → book cell `border-l`
- side collapsed / cell `hidden` → no `border-l`

Do not paint a permanent fill on the existing `w-1.5` resize handle (that is a 6px hover hit target, not the seam). Hover highlight stays.

### Titles

Reader `h1` and library `h1` both become `text-sm font-medium`. Keep `truncate` / `select-none` / drag handlers. Do not mute the color further.

### Docked chat header

`src/components/chat/ChatPanel.tsx` ~320:

- `variant !== "workspace"`: drop `border-b`; title `font-medium` instead of `font-semibold`.
- `variant === "workspace"`: keep `border-b` and current title weight (it is a real column header beside the session rail).

Do not move session / settings into the app header. Do not remount `ChatPanel` when toggling variant.

### Drawer titles

`TocSidebar` and `AnnotationsSidebar` title rows: `flex h-12 shrink-0 items-center border-b px-3 text-sm font-medium`. List padding can stay. Overlay geometry, backdrop, Esc, TOC resize handle, 标注 `w-56` stay.

## Data flow

None. No new state, storage keys, or locale strings unless an aria-label is rewritten (then pair zh-CN / en).

## Compatibility

- `src/App.annotations.test.tsx` and `src/App.reader-mode.test.tsx` already pin header button order and `reader-book-cell` owning the scrubber. Add class assertions for full-bleed and the mode-aware `border-l`.
- `src/components/LibraryView.test.tsx` should pin the library title class if it does not already.
- `src/components/chat/ChatPanel.test.tsx` should distinguish docked vs workspace header `border-b`.
- `component-guidelines.md` still says the book cell is `bg-muted/40` + `p-3` inset. Update that sentence in Phase 3.3 (same commit batch). Implement against this design until then.

## Tradeoffs

| Choice | Why | Rejected |
|---|---|---|
| Full-bleed | User decision; chrome recedes | Real well + inner border ("paper") |
| `border-l` on the right cell | One hairline, correct in both modes | Always `border-l` on chat (wrong in Agent); 6px filled resize handle |
| Keep progress `border-t` | Only remaining page / chrome seam | Surface-color-only footer (invisible in light) |
| Docked header loses `border-b` only | Session / settings stay put; least behavior change | Merge chat tools into the app header |

## Rollback

Revert the chrome class changes listed above. No disk format to migrate.
