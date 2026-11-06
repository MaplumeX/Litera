# 04: Book details as a page, and a tinted status bar

**What to build:** On the phone, Book details open as a full page with a `.cover-ambient` header (large cover, title, progress, Resume) instead of a centred dialog, with the cover flying in from the shelf.

**Blocked by:** 02

**Status:** ready-for-human

- [x] Phone layout for `BookDetailsDialog` (or a `MobileBookDetailsPage` sharing its form): ambient header running under the status bar, metadata and editing below
- [x] Shared element transition from the tapped cover via `rememberCoverOrigin` / `page-transition.ts`
- [x] While the dark header is under the status bar, `setSystemBarsLight(false)`; restored on scroll past and on leaving
- [x] Back closes the page, as with other phone pages
- [x] Tests: opens from the action sheet's Details, saves, Back closes
- [ ] Checked on Android: status bar icons readable on light and dark covers

## Comments
- `BookDetailsDialog` gains `layout="page"` (as `SettingsDialog` has) and `onOpen`; the desktop dialog renders as before from the same cover, summary and fields.
- Page: Material's full-screen edit pattern. Close and Save sit in a bar that is transparent over the header and takes `--cover-deep` once the content scrolls, so the status bar always sits on the cover's dark tone. The header runs up under the bar by a negative margin; its inset hairline is dropped edge to edge. A white button opens the Book ("Continue reading" / "Start reading"), dropping unsaved edits. The cover shows a change-cover badge, since touch has no hover.
- Status bar: `MobileApp` asks for light icons while `shelf.detailsBook` is set on the Library page, instead of the "restore on scroll past" in the checklist: the bar never leaves the cover colour, so there is nothing to restore until the page closes.
- Transition: `MobileLibraryPage` opens and closes details through `transitionPage` ("open"/"close") between `bookCover(id)` and the page's `[data-details-cover]`. While `data-page-motion` is set, page dialogs' own CSS entrance and exit stand down, so the view transition alone moves them and Radix unmounts at once on close.
- Tests: `MobileApp.test.tsx` opens details from the sheet (light icons, then dark again after Back), saves a new title from the bar, and opens the Book from the page. Seen in Chromium at 393×852 with a mocked IPC, at the top and scrolled. `tsc` clean; `vitest run`: 133 files, 1630 tests pass. The cover transition itself needs a device (jsdom has no View Transitions).

