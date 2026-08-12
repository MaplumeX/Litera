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
| `lucide-react` | Icon library for all toolbar/action buttons |

### Installed shadcn components

`src/components/ui/` holds the shadcn components copied into the project. Current set:

- `button.tsx` — all toolbar/action buttons (icon variants via lucide)
- `dialog.tsx` — modal overlays (used by `AgentConfigDialog`)
- `select.tsx` — dropdown selectors (used by `AgentConfigDialog` provider picker)
- `input.tsx` — text/password inputs
- `label.tsx` — form labels

**Rule**: New modals and form fields must use these shadcn components, not native `<select>`/`<input>`/`<label>`/hand-written overlay divs. Add more via `npx shadcn@latest add <name>` when needed; do not hand-roll equivalents.

**Select grouping**: use `SelectGroup` + `SelectLabel` + `SelectSeparator` for grouped options; do not emulate separators with disabled `<option>` values. Special pseudo-options (e.g. "add new…") are regular `SelectItem`s with sentinel string values handled in `onValueChange`.

### Icon Buttons (lucide-react)

**Decision**: All toolbar and action buttons use lucide-react icons via the `Button` `icon` / `icon-sm` / `icon-xs` size variants, not text labels.

**Why**: Modern reader UIs (Apple Books, Readwise Reader, 微信读书) use icon buttons with logical grouping to keep toolbars compact and immersive. Text-label buttons create visual noise and break the minimal aesthetic.

**How**:
```tsx
import { ChevronLeft, List, Settings } from "lucide-react"

// Good — icon button with aria-label for accessibility
<Button size="icon-sm" variant="ghost" aria-label="返回书库">
  <ChevronLeft />
</Button>

// Active state via variant, not text change
<Button size="icon-sm" variant={active ? "secondary" : "ghost"}>
  <List />
</Button>
```

**Rules**:
- Never use emoji characters (☰, ⚙, 📖) as button content — use lucide icons.
- Every icon-only button MUST have an `aria-label` for accessibility.
- Group related icon buttons in a `<div className="flex items-center gap-1">` container.
- Active/pressed states use `variant="secondary"` (background highlight); inactive uses `variant="ghost"`.

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

### Inject font/theme CSS via view.renderer.setStyles

**Problem**: Need to apply font family, font size, and theme colors to the EPUB content rendered inside foliate.js iframes, persisting across section changes.

**Solution**: `view.renderer.setStyles(css)` is a foliate.js Paginator built-in method. It stores the CSS string and automatically reapplies it on every section load (`#onLoad` calls `this.setStyles(this.#styles)`). No need to manually listen to `load` events.

```typescript
// view.renderer is a public field (not #private) on the View class
const css = `html, body {
  font-family: ${fontFamily};
  font-size: ${fontSize}px !important;
  ${themeColors}
}`
// Apply once — Paginator re-applies on every section change automatically
;(viewRef.current as any).renderer.setStyles(css)
```

Combine font + theme into one CSS string per call. Each style change replaces the full stylesheet (not additive).

**Caveat**: `view.renderer` is a non-official public field (not documented in foliate.js README). Submodule commit lock mitigates upgrade risk. Fixed-layout epub (foliate-fxl) may not support `setStyles` — MVP targets reflowable only.

### Pattern: auto-growing textarea inside a resizable panel

**Problem**: The chat input auto-grows via `el.style.height = Math.min(el.scrollHeight, 120) + "px"`. `scrollHeight` changes not only with the typed value but also with the element width (line wrapping), and the chat panel width is user-resizable (`react-resizable-panels`). Resizing the panel without typing would leave a stale height.

**Solution**: Recompute height on both value changes and element resizes; disconnect the observer on cleanup.

```typescript
useEffect(() => {
  const el = textareaRef.current;
  if (!el) return;
  const resize = () => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(el);
  return () => observer.disconnect();
}, [value]);
```

See `src/components/chat/ChatInput.tsx`. Do not add a third-party autosize library for this.

### Pattern: ref-stable callbacks to avoid effect re-runs

**Problem**: A component receives callback props (e.g. `onBookReady`, `onRelocate`) that change identity on every parent render. If these are used in a `useEffect` dependency array (e.g. the file-open effect), the effect re-runs on every parent render — causing the book to re-open repeatedly.

**Solution**: Store the latest callback in a ref updated on every render, and call it from a stable event handler. The effect dependency array stays empty (or only `fileData`).

```typescript
const onBookReadyRef = useRef(onBookReady)
onBookReadyRef.current = onBookReady  // update every render

useEffect(() => {
  // ... open book ...
  onBookReadyRef.current?.(toc)  // call latest without re-triggering effect
}, [fileData])  // not [fileData, onBookReady]
```