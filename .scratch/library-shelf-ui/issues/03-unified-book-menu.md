# 03: One book menu for dropdown and context menu

**What to build:** See spec "One book menu" and "Status placeholder on hover only".

**Status:** resolved

- [x] Dropdown and context menu render the same item list from one definition: Open, Reading status submenu (with check on current), Star/Unstar, Details…, Select, separator, Delete…
- [x] "Select" enters select mode with that Book preselected
- [x] Hover ✕ removed from `BookCard`; ⋯ sits in the top-right corner
- [x] Continue reading cards carry the menu
- [x] Unset status placeholder visible only on hover / focus / open; `BookStatusMenu` doc comment updated

## Comments

- One `BookActionItems` list renders into either Radix menu through a `MenuParts` object (Item / Separator / Sub / SubTrigger / SubContent), so the dropdown and context menu cannot drift. Curation and Select entries appear only when the host passes their callbacks.
- `deleteDisabled` (busy shelf) now disables the menu's Delete item, since the hover ✕ that used to carry it is gone. The label is "Delete…" because a confirmation follows.
