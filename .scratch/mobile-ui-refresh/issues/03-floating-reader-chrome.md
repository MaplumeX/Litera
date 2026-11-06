# 03: Floating reader chrome and a styled progress slider

**What to build:** The phone reader's bottom bar becomes a floating island over the page, the top bar blends into the page, and the progress slider gets the app's own look instead of the native one.

**Blocked by:** 01

**Status:** ready-for-human

- [x] Bottom bar: inset from the edges (`inset-x-3`, above `--safe-bottom`), `rounded-3xl`, `shadow-float`, `bg-page/90` with backdrop blur; progress row (or quick settings) and the five tabs inside it
- [x] Top bar: no `shadow-soft`; background fades from `--page` to transparent
- [x] Progress slider: custom track and thumb in the accent, matching the cover progress rails; keyboard, `aria-valuetext` and commit-on-release unchanged
- [x] `AssistantSheet`'s `peekOffset` follows the island's new height and gap
- [x] Slide in / out (`m-slide`) and `inert` when hidden still work; reduced motion respected
- [ ] Tests: existing reader chrome tests pass; slider still commits on pointer up / key up / blur
- [ ] Checked on Android in paginated and scrolled flow, light and dark, with gesture and 3-button navigation

## Comments
- Island: `inset-x-3`, `bottom: safe-bottom + 0.75rem`, `rounded-3xl overflow-hidden bg-page/90 backdrop-blur-xl shadow-float`; hidden it slides down by its height plus that gap. The quick settings render inside it unchanged.
- Top bar: `MobileAppBar` made transparent, the bar takes `bg-page`, and an `::after` 16px gradient (`pointer-events-none`) fades it into the page instead of `shadow-soft`.
- `peekOffset` is now `island height + safe-bottom + 0.75rem`, since the island no longer carries the safe-area padding.
- The page's own footer (chapter · %) now showed below the island and repeated the progress row, so it fades out while the chrome shows.
- Slider: `.reader-range` in `index.css`; the read part comes in as `--range-fill`. WebKit and Firefox pseudo-elements, a 20px accent thumb with a page-coloured ring, a focus ring on `:focus-visible`, the press scale dropped under reduced motion. The input, its `aria-*` and commit handlers are unchanged, so the existing tests still cover the commit paths.
- Seen in Chromium at 393×852 with a mocked IPC and a generated EPUB: chrome shown, quick settings open, dark. `tsc` clean; `vitest run`: 133 files, 1628 tests pass. Not yet on a device (gesture vs 3-button navigation, scrolled flow, the blur's cost on low-end phones).

