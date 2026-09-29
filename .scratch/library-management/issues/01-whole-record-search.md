# 01: Whole-record shelf search

**What to build:** Shelf search stops being a title/author-only substring match and becomes a tokenized filter across every text field a Book carries. Typing `penguin classics` matches a book in the Penguin Classics series even though no single field contains both words; typing a publisher or a language finds books too. Single-token behaviour is unchanged (a strict superset of today), and search stays synchronous and instant.

**Blocked by:** none.

**Status:** ready-for-agent

- [x] `filterBooks` in `src/lib/library-shelf.ts` lowercases the query, splits on whitespace, drops empty tokens, and requires **every** token to appear in at least one of `title`, `author`, `series`, `publisher`, `language`, `description`
- [x] An empty / whitespace-only query returns the list unchanged (existing behaviour preserved)
- [x] `null`/`undefined` optional fields are handled without throwing
- [x] Multi-token tokens may be satisfied by *different* fields (e.g. `tolkien hobbit` where one token hits `author`, the other `title`)
- [x] Case-insensitive; no regex/`field:value` syntax
- [x] Table-driven cases added to `src/lib/library-shelf.test.ts`: single token matching each of the six fields, multi-token across fields, no-match, empty query, whitespace-only query, and a record with absent optional fields
- [x] `library.searchPlaceholder` in `src/locales/en.ts` and `src/locales/zh-CN.ts` mentions the widened scope (en: "Search title, author, series…"; zh-CN equivalent) — both locale files keep identical key sets (`src/lib/i18n.test.ts` must stay green)

## Comments

- The six searchable fields are exactly the `BookRecord` text fields already in `src/types/library.ts`; `description` is already truncated to `MAX_DESCRIPTION_BYTES` at import, so no new size guard is needed.
- Do **not** extend search to `lastCfi`/`settings`/paths — those are not user-facing text.

- Implemented: `filterBooks` now tokenizes the query on whitespace and requires every token in a newline-joined haystack of the six fields. The newline separator guarantees two adjacent fields cannot spell a match together (covered by a test). Covered by 20 cases in `src/lib/library-shelf.test.ts` including per-field table-driven matches, multi-token-across-fields, absence of optional fields, and the adjacency guard.
- Placeholder updated in both locales; the two `LibraryView.test.tsx` queries that pinned the old placeholder copy were updated with it.
- Full frontend suite at the time of landing: 797 tests passing; `tsc --noEmit` clean.
