# Component Guidelines

> Component patterns for the Litera frontend.

---

## Component Library: shadcn/ui

**Decision**: shadcn/ui (Radix UI primitives + Tailwind CSS, code-copy model).

**Why**: Desktop reader aesthetic needs restraint and full customizability. shadcn/ui copies component source into the project (`src/components/ui/`), giving full ownership without npm runtime dependency or version lock.

**How to add components**:
```bash
npx shadcn@latest add <component-name>
```

## Companion Libraries

| Library | Purpose |
|---------|---------|
| `react-resizable-panels` | Draggable split-pane layout (shadcn/ui Resizable component base) |
| `react-markdown` + `remark-gfm` | Agent response Markdown rendering (lists, code blocks, tables) |

## Patterns

### Mount foliate-view web component in React

```typescript
// foliate-view is a custom element, not a React component
import "../foliate-js/view.js"  // registers <foliate-view> in customElements

const ref = useRef<HTMLElement>(null)
useEffect(() => {
  const view = document.createElement("foliate-view")
  ref.current?.appendChild(view)
  return () => view.remove()
}, [])
```

### Import shadcn/ui components via path alias
```typescript
// Good
import { Button } from "@/components/ui/button"

// Bad — relative path
import { Button } from "../../components/ui/button"
```

### cn() for conditional classes
```typescript
import { cn } from "@/lib/utils"

<div className={cn("flex gap-4", isActive && "bg-muted")} />
```

## foliate.js Patterns

### Offscreen metadata extraction (no DOM mount)

**Problem**: Need to extract EPUB metadata (title, author, cover) for the library grid without mounting a full `<foliate-view>` to the DOM.

**Solution**: `makeBook(file)` from `foliate-js/view.js` parses the EPUB and returns a `Book` object directly — no DOM element needed. Call `book.getCover()` for the cover Blob, then `book.destroy()` to clean up.

```typescript
import { makeBook } from "../foliate-js/view.js"

const file = new File([new Uint8Array(bytes)], name)
const book = await makeBook(file)
const title = extractFirstValue(book.metadata?.title) ?? name
const coverBlob = await book.getCover?.()  // Blob | null
book.destroy?.()  // clean up
```

See `src/lib/book-utils.ts` for the full implementation.

### Gotcha: foliate.js metadata fields can be language maps

> **Warning**: foliate.js `book.metadata.title` and author `name` fields are not always strings. They can be:
> - A plain string: `"Title"`
> - A language map: `{ en: "Title", zh: "书名" }`
> - An array of `{ lang?, value }` objects
> - A single `{ value }` object
>
> Always use a defensive extractor (like `extractFirstValue` in `book-utils.ts`) that handles all four formats. Naive `String(metadata.title)` would produce `"[object Object]"` for language maps.

### Gotcha: position restore must wait for init() to complete

> **Warning**: `view.init({})` internally calls `next()` to advance to the first content section. If you call `view.goToFraction(frac)` concurrently with `init()`, the two navigations conflict and the position may not restore correctly.
>
> **Correct order**: `await view.open(file)` → `await view.init({})` → `await view.goToFraction(frac)`. See `src/components/ReaderView.tsx`.

### Display app-data images via convertFileSrc

Images stored in Tauri's app data directory cannot be loaded via plain `file://` URLs (CSP blocks them). Use Tauri's asset protocol:

```typescript
import { convertFileSrc } from "@tauri-apps/api/core"

<img src={convertFileSrc(coverPath)} />
```

Requires `assetProtocol.enable = true` + `scope` in `tauri.conf.json`, and `img-src` CSP must include `asset:` and `http://asset.localhost`.