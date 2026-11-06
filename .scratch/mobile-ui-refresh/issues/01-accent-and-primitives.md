# 01: One selected look and shared touch primitives

**What to build:** Every selected chip, tab and pressed toolbar entry on the phone uses the accent, and the phone's hand-rolled controls are replaced by shared primitives. No layout changes.

**Blocked by:** None (can start immediately).

**Status:** ready-for-human

- [x] Status filter chips (`MobileLibraryPage.tsx`), drawer tabs (`MobileReaderPage.tsx`) and pressed `ToolbarTab` switch from `bg-secondary` to `bg-primary/10 text-primary`
- [x] Library status chips and action sheet status chips become one `ChoiceChips` component (radiogroup, check on the active one, status dot otherwise when given)
- [x] `SegmentedControl` gains a touch size (taller, rounded-full); `ReaderQuickSettings`' own segmented control is replaced by it, keeping arrow key navigation
- [x] Settings page layout: accent swatches grow from `size-5` to about 32px with a 48dp hit area
- [x] Assistant peek card (`AssistantSheet.tsx`) drops `border`, keeps `shadow-float`; its icon chip takes the accent tint
- [x] Tests: `ChoiceChips` and touch `SegmentedControl` behaviour; existing mobile tests pass
- [ ] Checked on Android in light and dark with two accents (e.g. cobalt and graphite)

## Comments

- `SegmentedControl` takes `size="touch"`, or its size from `SegmentedSizeContext`. The phone's Settings page provides "touch", so the Sync and KOReader Sync forms' controls grow too without threading a prop; `ReaderQuickSettings` passes it directly. The root carries `data-size` for tests.
- `ChoiceChips` lives in `src/mobile/`; the shelf's filter chips scroll sideways, the action sheet's wrap.
- The accent swatches grow only in the page layout (32px with an `::after` hit area to 48dp, `gap-4` so targets don't overlap); the desktop dialog is unchanged.
- `npx tsc --noEmit` clean; `vitest run`: 132 files, 1624 tests pass. Not yet seen on a device: left to the last box.

