# Research: annotation persistence (library store)

- Query: Where should Litera store EPUB bookmarks + single-color highlights so overwrite keeps them, delete removes them, and `deny_unknown_fields` does not break older builds
- Scope: internal (library.rs, backend specs, prior persistence research)
- Date: 2026-08-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src-tauri/src/library.rs` | `SCHEMA_VERSION`, `BookRecord`, `LibraryData`, `update_reading_state`, overwrite commit, delete, file validation |
| `src/types/library.ts` | Frontend `BookRecord` / `BookOpenContext` / `ReadingSettings` — no annotation fields |
| `.trellis/spec/backend/database-guidelines.md` | File layout, read-modify-write, `schemaVersion: 1`, optional shelf fields, no ORM |
| `.trellis/spec/backend/tauri-commands.md` | Command contracts; overwrite keeps `lastFraction` / `settings` / `lastOpenedAt`; delete removes `books/<id>/` + sessions |
| `.trellis/tasks/archive/2026-08/08-13-settings-ui-and-items/research/persistence-constraints.md` | `deny_unknown_fields` + rewrite / schema-bump hazards |
| `src/App.tsx:134-148` | Only `update_reading_state` for `{ lastFraction }` and full `settings` snapshot |

### Code Patterns

#### `library.json` types are closed

```17:17:src-tauri/src/library.rs
const SCHEMA_VERSION: u32 = 1;
```

```140:174:src-tauri/src/library.rs
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BookRecord {
    pub id: String,
    // ...
    pub last_fraction: Option<f64>,
    pub settings: Option<ReadingSettings>,
    pub last_opened_at: Option<String>,
    pub content_hash: Option<String>,
    content_version: Option<String>,
}
```

```214:219:src-tauri/src/library.rs
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LibraryData {
    schema_version: u32,
    books: Vec<BookRecord>,
}
```

`ReadingSettings` is also `deny_unknown_fields` (`library.rs:35-37`). `lastOpenedAt` / `contentHash` / `contentVersion` use `#[serde(default)]` so **older files** load in **newer** builds. The reverse is not true: a **new** key written into `library.json` makes **older** `deny_unknown_fields` builds fail the whole file.

`read_library_file` (`library.rs:1240-1254`) and init (`library.rs:873-877`):

- parse failure → `StorageCorrupt`
- `schema_version != 1` → `StorageCorrupt` (“Unsupported library schemaVersion”)
- unlike `preferences.json`, a corrupt/unsupported **library** is **not** overwritten with defaults

`update_reading_state` (`library.rs:808-848`) only patches `last_fraction` and replaces `settings`. It cannot grow an annotations array without a new `BookRecord` field.

#### `books/<id>/` layout and validation

On-disk layout today (`database-guidelines.md` / `tauri-commands.md`):

```
<app_data>/
├── library.json
├── books/<bookId>/
│   ├── book.epub
│   ├── cover.png          # optional
│   ├── .imports/
│   └── .transactions/
├── books/.trash/
└── sessions/<bookId>/
```

`validate_library_files` (`library.rs:1335-1365`) only requires:

- `books/<id>/` is a real directory
- `book.epub` is a regular file
- `cover.png` if `coverPath` is non-empty
- `.imports` / `.transactions` are real dirs **if present**

**Unknown extra files inside a known `books/<id>/` are not inspected.** `stage_orphaned_book_directories` (`library.rs:1033-1069`) only trashes **unregistered sibling directories** under `books/`, not extra files in a registered book dir.

`delete_book` (`library.rs:720-757`) `rename`s the **entire** `book_dir` into `books/.trash/<id>-<op>`, then drops the `library.json` row, then deletes `sessions/<bookId>/`. Anything stored in `books/<id>/` goes with the book. No extra cleanup hook is required for a per-book JSON file.

#### Overwrite keeps progress; it does not rewrite the book dir

`save_book_metadata` (`library.rs:539-551`) on overwrite updates only:

- `title`, `author`, `cover_path`, `content_hash`, `content_version`
- file bytes: `book.epub` (if reimport) and optional `cover.png`

It does **not** touch `last_fraction`, `settings`, `last_opened_at`, or any other file in `books/<id>/`.

Test `same_path_reimport_is_overwrite_and_keeps_progress` (`library.rs:2858-2896`) asserts `last_fraction` / `last_opened_at` / `settings` survive. Spec (`tauri-commands.md`): “An overwrite must keep `lastFraction`, `settings`, and `lastOpenedAt`.”

If annotations live in `books/<id>/annotations.json`, overwrite **already** keeps them. If they live on `BookRecord`, the overwrite path would also keep them (it does not rebuild the struct), but that reintroduces the schema problem below.

### Recommendation: per-book `books/<id>/annotations.json`

**Do not add `bookmarks` / `highlights` (or any annotations blob) to `BookRecord` / `library.json`.**

| Approach | Upgrade (old file, new app) | Downgrade (new file, old app) | Overwrite | Delete |
|---|---|---|---|---|
| New fields on `BookRecord` (`deny_unknown_fields`) | Need `#[serde(default)]` or every existing library fails | **Old app cannot parse `library.json` → `StorageCorrupt` for the whole library** | Survives (fields not cleared) | Survives as part of the record removal |
| Bump `SCHEMA_VERSION` to 2 | New app must dual-read v1 | Old app: unsupported schema → `StorageCorrupt` | n/a | n/a |
| `books/<id>/annotations.json` | Missing file = empty list | Old app **ignores** extra file; library still loads | File left in place automatically | Whole dir trashed automatically |

This matches the settings-task warning (`persistence-constraints.md`): do **not** bump `schemaVersion`; do **not** write keys that older `deny_unknown_fields` builds will see. Preferences even avoid rewriting a valid v1 file so older builds keep working. `library.json` is stricter (corrupt ≠ reset), so poisoning it is worse.

Also: `list_books` serializes every `BookRecord`. Putting growing highlight lists on the shelf record inflates every library load. Annotations are only needed when a book is open.

#### How to write the file

- Path: `<app_data>/books/<bookId>/annotations.json` (same trusted `book_dir` as EPUB).
- Gate: `LibraryStore` mutex, same as other book files.
- Write: `recoverable_atomic_write` / `atomic_write` (`library.rs:1550-1610`) — tempfile in the book dir, flush, persist, parent sync.
- Missing file on read: **empty annotations**, not `StorageCorrupt`. First bookmark/highlight creates the file.
- Present but invalid JSON / unsupported `schemaVersion` / failed `deny_unknown_fields`: `StorageCorrupt` (do not silently wipe user marks).
- Do **not** put this file through `validate_library_files` as a required artifact (that would break every existing book on first launch). Optional-if-present is enough.
- New Tauri commands (do **not** overload `update_reading_state` or `BookOpenContext` unless open-book really needs them). Smallest pair:

```rust
async fn get_annotations(store, book_id) -> AppResult<AnnotationsFile>
async fn save_annotations(store, book_id, data: AnnotationsFile) -> AppResult<()>
```

`save_annotations` is a **full snapshot replace** (same contract as `settings` on `update_reading_state`). Frontend always sends the complete bookmarks + highlights lists. Individual add/delete can be client-side + one save. Under the store gate, two overlapping saves still serialize; last snapshot wins — same as settings.

Do not add `dialog` / `fs` WebView permissions. Rust owns the path.

Frontend `list_books` / `BookRecord` stay unchanged. Load annotations when the reader opens that `bookId`.

#### Overwrite / delete / content-hash caveats

- **Overwrite same book**: keep the file. CFIs may no longer resolve if the new EPUB tree differs (see `foliate-annotations.md`). That is a locator problem, not a store problem. Bookmarks still have `fraction` as jump fallback. Dead highlight CFIs simply fail to paint; deleting them from the list is enough.
- **Duplicate import** (same bytes, other path): new `bookId` / new dir → empty annotations. Correct; marks are per library record, not per content hash.
- **Delete**: `delete_book` already removes the directory (then sessions). No new session-style extra delete is required. Trash retains the file until a future retention sweep.
- **Do not** copy annotations into `.imports` / `.transactions`. They are not part of the EPUB version.

### Proposed JSON shape (MVP, no notes, no colors)

Own `schemaVersion: 1`, **not** `library.json`’s version. `deny_unknown_fields` on the file and on each item so unknown future keys do not silently drop.

```json
{
  "schemaVersion": 1,
  "bookmarks": [
    {
      "id": "b_01hxyz",
      "cfi": "epubcfi(/6/8!/4/2,/1:0,/1:80)",
      "fraction": 0.42,
      "createdAt": "2026-08-14T12:00:00+00:00",
      "label": "Chapter 3"
    }
  ],
  "highlights": [
    {
      "id": "h_01hxyz",
      "cfi": "epubcfi(/6/8!/4/2,/1:12,/1:48)",
      "excerpt": "selected sentence…",
      "createdAt": "2026-08-14T12:01:00+00:00"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | yes | `1`. Unsupported → `StorageCorrupt`. Do not bump for additive optional keys; add `#[serde(default)]` instead (same rule as `lastOpenedAt`). |
| `bookmarks[]` / `highlights[]` | yes | Missing key on a v1 file can `serde(default)` to `[]`. |
| `id` | yes | Opaque client or Rust id (ulid / hex). Overlay key in foliate-js is **CFI**, not this id. Persist id for list delete / React keys. |
| `cfi` | yes | Bookmark: `relocate.detail.cfi` (visible page). Highlight: `view.getCFI(index, range)`. Must match `^epubcfi\(`. |
| `fraction` | bookmark: yes | `0..=1`, same validator as `lastFraction`. Sort / progress label / `goToFraction` fallback. Highlights do not need it. |
| `createdAt` | yes | RFC3339, same as `importedAt`. |
| `label` | bookmark: optional | `tocItem.label` at pin time. Display only. |
| `excerpt` | highlight: yes | `selection.toString().trim()`, length-capped (suggest ≤ 2–4 KiB like title). List row + sanity check. |

**Explicitly omitted:** `color`, `note`, `href`, `index`, `chapterHref`, `style`. Single color is a renderer constant (`Overlayer.highlight`), not stored.

Rust sketch (not implemented here):

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnnotationsFile {
    schema_version: u32,
    #[serde(default)]
    bookmarks: Vec<BookmarkRecord>,
    #[serde(default)]
    highlights: Vec<HighlightRecord>,
}
```

Validate: book exists; each `cfi` non-empty + reasonable max bytes; `fraction` finite `0..=1`; `excerpt` / `label` byte caps; unique `id`s. Empty lists are valid (user deleted everything) — may write `{ schemaVersion: 1, bookmarks: [], highlights: [] }` or delete the file; either is fine if read treats missing as empty.

### Related Specs

- `.trellis/spec/backend/database-guidelines.md` — JSON file store, `schemaVersion: 1`, atomic write, optional shelf fields without a bump. Storage layout will need `annotations.json` listed when implementing.
- `.trellis/spec/backend/tauri-commands.md` — overwrite keep-progress; delete whole dir + sessions; no WebView `fs`.
- `.trellis/tasks/archive/2026-08/08-13-settings-ui-and-items/research/persistence-constraints.md` — `deny_unknown_fields` downgrade / rewrite hazards.
- `.trellis/tasks/08-14-reader-annotate-and-progress/prd.md` — persist across reopen; overwrite must not drop marks (implied by “重开该书后书签/高亮仍在”).

## Caveats / Not Found

- No existing annotations file, command, or frontend type. This is a new persistence surface.
- `BookOpenContext` does not need annotations unless the implementer wants one less round-trip; a dedicated `get_annotations` after open is enough and keeps context stable for older frontends.
- If a future change **must** put a pointer on `BookRecord` (e.g. `hasAnnotations: bool` for a shelf badge), that still poisons old builds unless it is never written — so do not do it in this task.
- CFI validity after overwrite is not a library.rs concern; store the strings as-is.
- Session JSONL / sidecar is unrelated; do not store marks there.
