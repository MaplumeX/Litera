# 02: Library Hero and large title

**What to build:** The phone's shelf opens on a Hero like the desktop's: the Book last read in its cover's colour, the other Books in progress as small covers under it. The "Shelf" title starts large and collapses into the app bar on scroll.

**Blocked by:** 01

**Status:** ready-for-human

- [x] Replace the swipeable `MobileResumeCard` row with a full-width Hero: cover (~w-24), title `text-xl font-semibold` with tight tracking, author · last opened, white progress rail, white "Resume" button
- [x] Other Books in progress sit in a row of small covers under it; a tap shows that Book in the Hero (cover colours ease via the existing `@property` transition), a tap on the shown one opens it
- [x] Long-press on any Hero cover still opens the action sheet; `rememberCoverOrigin` still feeds the open transition
- [x] Large title: ~28px semibold "Shelf" at the top of the scroll content, collapsing into the 56dp `MobileAppBar` title once scrolled past
- [x] Reduced motion: no colour easing, no title animation
- [x] Tests: Hero tap switches then opens; long-press opens actions
- [ ] Checked on Android with books with and without covers (generated covers)

## Comments

- Resolved: same as desktop. `recents` comes from the shared `use-library-shelf.ts`: hidden while searching (and selecting), narrowed by the status filter. The phone already uses it, so the Hero keeps that for free.
- The small covers list every Book in progress, the shown one included and outlined (`aria-pressed`). They never reorder: a first tap shows a Book, a tap on the shown one opens it. The title reserves two lines (`min-h-[2lh]`) so the card's height, and the covers under the thumb, stay put when switching.
- Only the big cover carries `data-book-cover`, so the open transition always grows from it (`rememberCoverOrigin` on the section).
- Large title: an `aria-hidden` 28px line at the top of the scroll content; the app bar's `h1` keeps the name for screen readers and fades in once the title has scrolled under it. Not shown while searching or with an empty Library.
- The status chips moved into the scroller and stick under the app bar, with a hairline once the shelf runs beneath them.
- `MobileResumeCard` is gone; `ProgressRail` is exported for the Hero.
- Seen in Chromium at 393×852 with a mocked IPC (light/dark, cobalt/violet, scrolled, after a switch). `tsc` clean; `vitest run`: 133 files, 1628 tests pass. Not yet on a device.

