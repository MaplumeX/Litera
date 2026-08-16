# Design: list_annotations

## Boundaries

| Layer | Change |
|---|---|
| `LiteraAgentRuntime` | Register `list_annotations`. Inject `loadAnnotations(bookId)` (default `invoke("get_annotations")`). |
| System prompt | One sentence: use `list_annotations` for the reader's highlights/bookmarks. |
| Tests | Runtime unit test with a fake `loadAnnotations`; no live Tauri. |
| Rust / worker / chat UI | None in this child. |

## Contracts

Input: none (`Type.Object({})`).

Output JSON text:

```json
{
  "bookmarks": [
    { "id": "b1", "cfi": "epubcfi(/6/8!/4/2/1:0)", "fraction": 0.2, "createdAt": "2026-08-14T00:00:00.000Z", "label": "Loomings" }
  ],
  "highlights": [
    { "id": "h1", "cfi": "epubcfi(/6/8!/4/2,/1:12,/1:48)", "excerpt": "Call me Ishmael.", "createdAt": "2026-08-14T00:00:00.000Z" }
  ]
}
```

Map 1:1 from `AnnotationsFile`. Drop `label` when undefined. Do not invent chapter titles.

Errors:

- No open book / `bookId` mismatch → throw like other tools; `bookCall` already gates this.
- `get_annotations` failure → structured tool error result (do not throw past the tool), same as missing-chapter `read_chapter`.
- Missing file is not an error: Rust already returns empty lists.

## Data flow

```
model tool call list_annotations
  → tools() execute
  → bookCall(bookId, () => loadAnnotations(bookId))
  → invoke get_annotations
  → result(JSON.stringify({ bookmarks, highlights }))
```

Do not read `App` annotation state. Disk is the source of truth and stays in sync because highlight/bookmark commits already `save_annotations`.

Constructor option `loadAnnotations` keeps `embedded-runtime` tests off Tauri.

## Prompt

Keep the existing one-line identity. Append that highlights and bookmarks are available via `list_annotations` when the user asks about what they marked, and that the tool should not be called for ordinary chapter questions.

## Compatibility

- Existing four tools unchanged.
- Sessions without this tool keep working.
- `BookContentPort` unchanged.

## Rollback

Revert the runtime + test + locale-free prompt string. No data migration.
