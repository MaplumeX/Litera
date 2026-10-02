# 02: Sort direction and a series column

**What to build:** Every shelf sort key becomes reversible, with each key starting in its natural direction, and the direction is remembered between launches. List view gains a series column so near-identical titles across series can be told apart.

**Blocked by:** none.

**Status:** ready-for-agent

- [x] `LibrarySortOrder = "asc" | "desc"` and a `naturalOrderFor(key)` helper added to `src/lib/library-shelf.ts`; naturals are `title`/`author` → `asc`, `recent`/`imported`/`progress` → `desc`
- [x] `sortBooks(books, key, order)` applies the direction to the key's comparator; the third argument defaults to `naturalOrderFor(key)` so existing call sites keep working
- [x] Direction reverses the *primary* comparison only; existing tie-breakers/fallbacks (e.g. `compareProgress` falling back to recency, `compareAuthor` falling back to title, `compareRecent` falling back to `importedAt`) keep their current meaning and are not also inverted
- [x] `src/lib/library-shelf-prefs.ts` persists the order under a new key (e.g. `litera.librarySortOrder`) with the same defensive load/save/parse shape as the existing sort key, including the private-mode/quota no-throw behaviour
- [x] Switching sort key resets direction to that key's natural direction; the toggle button flips the current direction
- [x] `src/components/LibraryView.tsx` renders a sort-direction toggle (`size="icon-sm"`, `aria-label` + `aria-pressed` naming ascending/descending) next to the sort `Select`, only when the shelf is non-empty
- [x] `src/components/BookCard.tsx`'s `BookListRow` shows the series (hidden below `md`, like the last-opened column) between author and progress
- [x] Cases added to `src/lib/library-shelf.test.ts`: each key ascending and descending, natural defaults per key, and that reversal does not invert fallbacks
- [x] Cases added to `src/lib/library-shelf-prefs.test.ts`: round-trip, invalid value falls back to the key's natural default, storage throwing does not throw
- [x] `src/components/LibraryView.test.tsx` asserts the toggled order reaches the rendered list (assert rendered order, not internal state)
- [x] New i18n keys for the ascending/descending labels in both `src/locales/en.ts` and `src/locales/zh-CN.ts`

## Comments

- Keep the shelf's existing `filterBooks` → `sortBooks` pipeline order; direction must not affect filtering.
- `library.sort` already exists as the `Select`'s `aria-label`; the toggle needs a distinct label so tests and screen readers can tell them apart.

- Implemented: `LibrarySortOrder`, `naturalOrderFor`, and `isLibrarySortOrder` in `library-shelf.ts`; `sortBooks(books, key, order = naturalOrderFor(key))`. Comparators take a `Direction` and multiply only the primary comparison, so the "no author / no progress / never opened go last" rules and the fallbacks (`compareImported`, `compareRecent`, `compareTitle` with a fixed direction) keep their meaning when reversed.
- Discovery worth recording: the existing comparators return `0` when two books have *equal* primary values, so the fallbacks only fire in the empty-value branches, not on ties. That is unchanged behaviour — the tie-break test asserts the empty-value branches rather than equal values.
- `litera.librarySortOrder` persisted via `loadLibrarySortOrder(sort)` / `saveLibrarySortOrder`; the loader requires the sort key because the fallback is the key's natural direction. Switching sort key resets the direction to the new key's natural default.
- The direction control is a single toggle (`aria-label` = "升序排列" / "降序排列", `aria-pressed`, `data-sort-order`) rather than two buttons, to keep the already-dense header from growing; the tests assert through `data-sort-order` and the rendered order.
- `BookListRow` renders the series column unconditionally (blank when absent) so rows keep their columns aligned, unlike the conditionally-rendered cache/last-opened columns.
- Full frontend suite at the time of landing: 797 tests passing; `tsc --noEmit` clean.

## Comments (review fixes)

- The five-way ternary cascade in `sortBooks` paralleled `NATURAL_ORDER`; both now live in lookup tables (`SORT_COMPARATORS`, `NATURAL_ORDER`), so adding a key cannot update one and forget the other.
