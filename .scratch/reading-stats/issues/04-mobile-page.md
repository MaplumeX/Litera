# 04: Mobile Reading stats page

**What to build:** The same page on Android, reached from the Library's overflow menu.

**Blocked by:** 03

**Status:** ready-for-human

- [x] An item in the Library's overflow menu, above Trash, opens a new `stats` page in `MobileApp`'s page stack, with Trash's transition and back behaviour
- [x] Reuses the desktop page's sections rather than duplicating them
- [x] Tiles 2×2; the rest in one column
- [x] The heatmap scrolls horizontally, starting at the latest weeks; a tap picks a day, since there is no hover
- [x] Opening a Book from the ranking goes through the mobile reader path
- [x] Component tests
- [ ] Checked on an Android device or emulator, including touch, the page transition, and that time stops when the phone is locked

## Comments

- The entry is in the overflow menu, not `MobileDrawer`: that is where Trash lives on the Library. Spec updated.
- A tap on a time bar names it in the section header, since Tips need a pointer. This applies on desktop too. Heatmap hover now reacts to a mouse only, so a finger scrolling past does not change the readout.
- Checked the layout only, in the desktop binary with a 412x880 window and an Android user agent (temp data directory, seeded log): 2x2 tiles, no horizontal overflow, heatmap starting at the latest weeks and its scrollbar clear of the cells, Year view, the deleted Book row.
- Not a device check: the app's Android bridge commands are missing there (`getInsets` and others fail), and this machine has no device, emulator or `/dev/kvm`.
- Under WSLg, `document.startViewTransition` never committed, leaving the shell stuck on the Library, so the check turned it off to use the fallback path. Trash shares that path. Confirm the View Transition on a device. During that stuck state the app also exited once with nothing in its log; the cause is unknown.
