# 04: Book details as a page, and a tinted status bar

**What to build:** On the phone, Book details open as a full page with a `.cover-ambient` header (large cover, title, progress, Resume) instead of a centred dialog, with the cover flying in from the shelf.

**Blocked by:** 02

**Status:** needs-triage

- [ ] Phone layout for `BookDetailsDialog` (or a `MobileBookDetailsPage` sharing its form): ambient header running under the status bar, metadata and editing below
- [ ] Shared element transition from the tapped cover via `rememberCoverOrigin` / `page-transition.ts`
- [ ] While the dark header is under the status bar, `setSystemBarsLight(false)`; restored on scroll past and on leaving
- [ ] Back closes the page, as with other phone pages
- [ ] Tests: opens from the action sheet's Details, saves, Back closes
- [ ] Checked on Android: status bar icons readable on light and dark covers

## Comments
