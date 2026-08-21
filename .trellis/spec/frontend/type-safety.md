# Type Safety

> TypeScript conventions for the Litera frontend. Types are kept minimal and close to usage. There is no runtime validation library (no Zod, io-ts, or Yup) — types are compile-time contracts aligned with Rust serde.

---

## Overview

Litera's frontend uses TypeScript 5.8 with strict mode. Shared types live in `src/types/`, component-local types live in their component files. The critical type contract is between frontend TypeScript interfaces and Rust `#[serde(rename = "camelCase")]` structs.

Reference files:
- `src/types/library.ts` — shared domain types (`BookRecord`, `ReadingSettings`, `ImportBookResult`, `BookOpenContext`, `AnnotationsFile`)
- `src/components/ReaderView.tsx` — `ReaderViewHandle`, `TocItem`, `SelectionCapture`, `RelocateDetail`
- `src/components/ChatPanel.tsx` — `ChatMessage`, `ToolCall`, `SessionSummary`, `HistoryMessage`
- `src/foliate-js.d.ts` — ambient declarations for foliate.js modules
- `src-tauri/src/lib.rs` — Rust structs with `#[serde(rename = "camelCase")]`

---

## Type Organization

### Shared domain types: `src/types/`

Types used across multiple components go in `src/types/`. Currently only `library.ts`:

```typescript
// src/types/library.ts
export interface BookRecord {
  id: string;
  title: string;
  author: string;
  coverPath: string;      // camelCase matches Rust #[serde(rename = "camelCase")]
  filePath: string;
  importedAt: string;      // ISO 8601 (RFC3339)
  lastFraction?: number;
  settings?: ReadingSettings;
  lastOpenedAt?: string;
  contentHash?: string;
  lastReaderMode?: "reader" | "agent";
  lastLayout?: ReaderLayout;
}

// books/<id>/annotations.json — not fields on BookRecord
type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange";
interface HighlightRecord {
  id: string;
  cfi: string;
  excerpt: string;
  createdAt: string;
  color?: HighlightColor; // omit = yellow; persist the id, not hex
  note?: string;          // omit / empty = no note
}
interface AnnotationsFile {
  schemaVersion: number;
  bookmarks: BookmarkRecord[];
  highlights: HighlightRecord[];
}
```

### Component-local types: inline in component files

Types used by a single component are declared in the same file and exported only if a parent needs them (e.g. `ReaderViewHandle`):

```typescript
// src/components/ReaderView.tsx
export interface ReaderViewHandle { ... }
export interface TocItem { ... }
interface ReaderViewProps { ... }  // not exported — only used here
```

### Ambient module declarations: `src/foliate-js.d.ts`

foliate.js is a git submodule with no bundled types. Ambient declarations provide minimal typing:

```typescript
// src/foliate-js.d.ts
declare module "../foliate-js/view.js" {
  export function makeBook(file: File): Promise<Book>;
  // ...
}
```

Host-only APIs used by the reader (`initTTS`, `TTS` methods returning `string | undefined`, `renderer.getContents`, `lastLocation.range`) belong in this file. Do not add `any`. Do not patch the submodule to invent types.

---

## Rust ↔ TypeScript Contract

The most important type safety rule: **frontend interfaces must match Rust struct field names after serde camelCase renaming**.

```rust
// src-tauri/src/lib.rs
#[derive(Serialize, Deserialize, Clone)]
struct BookRecord {
    #[serde(rename = "coverPath")]
    cover_path: String,           // Rust snake_case → TS coverPath
    #[serde(rename = "filePath")]
    file_path: String,
    #[serde(rename = "importedAt")]
    imported_at: String,
    #[serde(rename = "lastFraction", skip_serializing_if = "Option::is_none")]
    last_fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    settings: Option<ReadingSettings>,  // no rename needed — already camelCase
}
```

```typescript
// src/types/library.ts — must match exactly
interface BookRecord {
  coverPath: string;
  filePath: string;
  importedAt: string;
  lastFraction?: number;      // Option<T> → optional field (?:)
  settings?: ReadingSettings;
}
```

### Rules

- `Option<T>` → `T | undefined` → optional field (`field?: T`).
- Structured `Vec<u8>` fields (for small values such as cover bytes) → `number[]` through JSON serialization.
- Large EPUB `Vec<u8>` values must return `tauri::ipc::Response::new(bytes)` and be received with `invoke<ArrayBuffer>()`; create a `Uint8Array` view without `Array.from` or another full-payload copy.
- `skip_serializing_if = "Option::is_none"` → frontend field must be optional (`?:`), not nullable.
- `#[serde(rename = "...")]` must match the TS field name exactly.
- `invoke<T>("command_name")` must specify the return type: `invoke<BookRecord[]>("list_books")`.

---

## Validation

There is **no runtime validation** of `invoke()` return types. The contract is compile-time only. If Rust returns a shape that doesn't match the TS interface, the app will misbehave at runtime with no error.

**Implication**: when changing a Rust struct's serde output, update the matching TS interface in the same commit. The `tauri-commands.md` spec documents these contracts as the source of truth.

---

## foliate.js Typing (Unstable API)

foliate.js is an untyped web component. Accessing its methods requires type assertions:

```typescript
// src/components/ReaderView.tsx
const view = viewRef.current as unknown as {
  open: (file: File) => Promise<void>;
  init: (opts: Record<string, unknown>) => Promise<void>;
  goToFraction: (frac: number) => Promise<void>;
};
```

### Pattern: narrow `as unknown as` casts at the point of use

foliate.js methods are accessed via localized `as unknown as { ... }` casts with inline interface literals. This keeps the unstable API surface visible at each call site rather than hiding it behind a shared type that might get stale.

### Pattern: defensive optional chaining for unstable fields

```typescript
const book = (view as unknown as { book?: { toc?: TocItem[] } }).book;
onBookReadyRef.current?.(book?.toc ?? []);
```

`view.renderer` is a non-official public field:
```typescript
const view = viewRef.current as unknown as { renderer?: { setStyles?: (c: string) => void } };
view?.renderer?.setStyles?.(css);
```

---

## Common Patterns

### `extractFirstValue` — defensive union extraction

foliate.js metadata fields can be string | language map | array | object. A single helper handles all cases:

```typescript
// src/lib/book-utils.ts
function extractFirstValue(raw: unknown): string | null { ... }
```

**Rule**: when consuming foliate.js metadata, always go through `extractFirstValue`. Never assume `metadata.title` is a string.

### `normalizeSettings` — fill defaults from optional persisted state

```typescript
// src/lib/reader-styles.ts
export function normalizeSettings(
  settings?: ReadingSettings,
  preferences?: Partial<TypographyDefaults> & { theme?: string },
): ReaderStyleState {
  return {
    fontSize: settings?.fontSize ?? preferences?.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: settings?.fontFamily ?? preferences?.fontFamily ?? DEFAULT_FONT_FAMILY,
    theme: preferences?.theme ?? DEFAULT_THEME,
    lineHeight: settings?.lineHeight ?? preferences?.lineHeight ?? DEFAULT_LINE_HEIGHT,
    contentWidth: settings?.contentWidth ?? preferences?.contentWidth ?? DEFAULT_CONTENT_WIDTH,
    pagePadding: settings?.pagePadding ?? preferences?.pagePadding ?? DEFAULT_PAGE_PADDING,
    textAlign: normalizeTextAlign(settings?.textAlign ?? preferences?.textAlign),
    letterSpacing: settings?.letterSpacing ?? preferences?.letterSpacing ?? DEFAULT_LETTER_SPACING,
    paragraphSpacing: settings?.paragraphSpacing ?? preferences?.paragraphSpacing ?? DEFAULT_PARAGRAPH_SPACING,
    firstLineIndent: settings?.firstLineIndent ?? preferences?.firstLineIndent ?? DEFAULT_FIRST_LINE_INDENT,
  };
}
```

---

## Forbidden Patterns

### `any`

Never use `any`. Use `unknown` and narrow with type guards or `as unknown as { ... }` casts.

### Untyped `invoke()` calls

**Wrong**: `const result = await invoke("list_books")` (result is `any`).

**Correct**: `const list = await invoke<BookRecord[]>("list_books")`.

### Sharing types that should be local

If a type is used by only one component, keep it in that component file. Don't pollute `src/types/` with single-use types.

### Assuming foliate.js field types

foliate.js `metadata.title` is NOT always a string. Always use `extractFirstValue` or a defensive accessor. See the "language map" gotcha in `component-guidelines.md`.
