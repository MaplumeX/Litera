# 06: Quieter shelf cards

**What to build:** See spec "Quieter cards".

**Status:** resolved

- [x] Unstarred star on `BookCard` / `BookListRow` visible only on hover / focus; starred stays visible
- [x] Cover "not downloaded" badge is icon-only with tooltip and accessible label

## Comments

- Hover-only is CSS (`group-hover` / `focus-visible`), so keyboard users still reach the star by tabbing; it is also in the book menu since 03.
