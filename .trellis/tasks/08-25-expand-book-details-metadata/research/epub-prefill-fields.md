# EPUB / foliate metadata for shelf prefill

## Source

foliate-js `book.metadata` follows Readium Web Publication Manifest-style fields. Titles and names can be a string, a language map, or `{ value }` / arrays of those. Litera already normalizes this with `extractFirstValue` in `src/lib/book-utils.ts`.

## Fields this task needs

| Shelf field | foliate `book.metadata` | EPUB origin |
| --- | --- | --- |
| description | `description` | `dc:description` (sometimes HTML) |
| publisher | `publisher` | `dc:publisher` |
| language | `language` | `dc:language` — string or BCP-47 array |
| series | `belongsTo.series` (name; optional position) | EPUB3 `belongs-to-collection` / Calibre `calibre:series` |

Readium maps `belongsTo.series` as `{ name, sortAs?, identifier?, position? }`. If only a name exists, store the name. If `position` is a finite number, store one string `"{name} · {position}"` (series is a single shelf field).

## Normalization

- Reuse `extractFirstValue` for publisher / description / series name.
- Language: if string, use it; if array, join non-empty strings with `", "`.
- Description: strip tags and collapse whitespace to plain text. Do not add an HTML sanitizer library.
- Missing / unparseable → empty string. Import must still succeed.
- If a normalized string exceeds the backend byte cap, truncate on the extract side so commit does not fail.

## Not used

`subject`, `identifier`, `published`, `belongsTo.collection` — out of scope (no tags / ISBN / year).
