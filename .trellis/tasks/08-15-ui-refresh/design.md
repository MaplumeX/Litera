# Design: Beautify desktop reader UI

## Boundaries

This task restyles the **app chrome** only.

In:

- Tokens and global type in `src/index.css` + `src/main.tsx`
- Shared shadcn primitives under `src/components/ui/` if a visual tweak is cheaper there than at every call site
- Library: `LibraryView`, `BookCard`, import banners
- Reader chrome: `App.tsx` header/grid, `ReaderProgressBar`, `TocSidebar`, `AnnotationsSidebar`, `SelectionToolbar`, `WindowControls`
- Chat: `ChatPanel` and its children
- Settings / agent config dialogs

Out:

- `src/foliate-js/`
- `generateStylesCss` / reader theme palettes (book page colors stay user-owned)
- Layout geometry already specified in frontend `component-guidelines.md` (header `h-12`, chat/book widths, overlay TOC/标注, mode grid areas)
- `preferences.json` schema, icon library, new features

## Visual language

Product-tool, Linear-adjacent. Dials: variance 4, motion 3, density 5.

| Token | Direction |
|---|---|
| Neutrals | Cool zinc. Light canvas slightly off-white (not `#fff`). Dark canvas slightly lifted charcoal (not `#000`). One gray family only. |
| Accent | None beyond primary. Primary is near-black (light) / near-white (dark). No second brand color, no purple/blue glow. |
| Radius | One scale. Tighten `--radius` from `0.625rem` to `0.5rem`. Buttons/inputs inherit. Covers stay slightly tighter than containers. |
| Elevation | No `shadow-sm` / `shadow-md` on cards or chat composer. 1px `border`, `divide-y`, or a one-step surface shift. |
| Type | Chrome: Geist Variable + CJK fallbacks (see research). Weights 400 / 500 / 600. Tabular nums on percents. Reader iframe: unchanged. |
| Motion | 200-300ms `transform` / `opacity` / color on hover and `:active` (`scale(0.98)`). No scroll-hijack, no page enter choreography. Honor `prefers-reduced-motion`. |

## Font loading

1. Add `@fontsource-variable/geist`.
2. Import `wght.css` from `src/main.tsx` before `./index.css`.
3. Set Tailwind `--font-sans` in `@theme inline` to the installed family name plus CJK fallbacks.
4. Apply `font-sans` on the existing `body` / `main` chrome. Do not inject Geist into `generateStylesCss`.

Vite will emit woff2 as same-origin assets. CSP does not need a change if that holds; if a font 404s in the WebView, fix the import path, do not loosen `font-src`.

## Surface map

### Foundation

Recolor shadcn variables in `src/index.css`. Most screens pick this up for free. Keep semantic names (`--background`, `--primary`, `--muted`, …).

### Library

- Header stays `titlebarClassName()`. Title weight 600, not loud bold. Search uses the shared `Input` look (or matching classes), not a one-off native input.
- Covers: drop box-shadow; 1px border; hover is a 1px ring or border shift, not a larger shadow. Missing-cover glyph stays a letter on a flat muted field (no gradient).
- Progress chip: tabular nums, quieter overlay.
- Delete: lucide `X`, `aria-label` from `useT()`, same hover-reveal behavior.
- Empty library: same copy keys unless a short extra line is needed; then add zh-CN + en. Compose with spacing, not illustration.

### Reader chrome

- Header / icon cluster / window buttons: token + type only. Do not restack icons or change `aria-label`s that tests bind to.
- Progress bar: thinner, quieter track; keep seek math and label format.
- TOC / 标注 drawers: border + background token, drop `shadow-md` if it is the only depth cue.
- Selection toolbar: match button radius and hover.

### Chat

- Composer: drop `shadow-sm`, use `rounded-xl` (not a large pill) + 1px border.
- User bubbles: same radius family as composer (`rounded-xl`), keep `bg-primary`.
- Assistant markdown: no extra card chrome unless a border is needed to separate from the canvas.
- Empty chat: keep suggestions; flatten the circular bot badge if it looks like a marketing avatar.

### Settings / agent config

- Dialog shell already has a fixed size. Tokens should restyle it.
- `SegmentedControl` stays (not a toggle-group). Selected segment is `bg-background` + hairline, not a filled primary CTA.

## Compatibility

- Class-string tests (`toContain("max-w-...")`, `getByRole`, aria-labels) must keep passing. If a test pins a decorative class we intentionally remove (`shadow-sm`), update that assertion only.
- i18n: new strings only through `src/locales/zh-CN.ts` + `en.ts`.
- No Rust / IPC / preferences changes.

## Tradeoffs

- Geist will not draw Chinese; fallbacks will look slightly different from Latin. Accepted. Shipping a CJK webfont is out of scope.
- Tightening radius and killing shadows is a global look change. Doing it at tokens first avoids per-page drift.
- Not splitting into child tasks: a half-migrated chrome fails R2.

## Rollback

Revert the frontend files from this task and remove `@fontsource-variable/geist`. No data migration.
