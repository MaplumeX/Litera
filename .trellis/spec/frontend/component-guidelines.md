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
- `dialog.tsx` — modal overlays (used by `AgentConfigDialog` and `SettingsDialog`)
- `alert-dialog.tsx` — destructive confirms (library delete / overwrite)
- `select.tsx` — dropdown selectors (used by `AgentConfigDialog` provider picker)
- `slider.tsx` — continuous typography controls on `SettingsDialog`
- `popover.tsx` + `command.tsx` — searchable combobox (reader font picker)
- `input.tsx` — text/password inputs
- `label.tsx` — form labels

**Rule**: New modals and form fields must use these shadcn components, not native `<select>`/`<input>`/`<label>`/hand-written overlay divs. Add more via `npx shadcn@latest add <name>` when needed. `alert-dialog.tsx` may match the existing `dialog.tsx` Radix style if the CLI add fails; do not use `window.confirm()` / `window.alert()`.

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

### Convention: reader chrome is reading-first

**What**: The reader view is book-title + overlay TOC + on-demand chat. Chat starts collapsed. TOC is never a third column. There is no dedicated reader progress chrome.

**Why**: A fixed TOC column and a default 35% chat pane make the book a side panel. Toggling chat by remounting `ReaderView` / `ChatPanel` reopens the EPUB and breaks `fillInput`. A permanent progress row under the header also steals chrome from the book; chapter identity belongs in TOC, and `lastFraction` is shown on library cards.

**Layout**:
```
header:   [←]  book title (h1, truncate)     [TOC][Aa][chat]
body:     [TOC overlay]  Reader  |  Chat (collapsed = 0 width, still mounted)
```

### Convention: chat locator is a chapter href, not a spine index

**What**: `ReaderView` relocate / selection capture a `chapterHref` (`tocItem.href` if truthy, else `book.sections[index].id`) and pass it through `App` → `ChatPanel` → `agent_prompt` / `agent_edit_prompt`. Empty string is not a locator — fall back to section `id`, then omit.

**Why**: Foliate `relocate.detail.index` is a spine file. Sidecar tools use a TOC-owned chapter list. Sending the integer made the aside say "第 N 章" for the wrong object.

**Rules**:
- Do not send `chapterIndex` on the live prompt path (`PromptContext` is `deny_unknown_fields`).
- Clear `chapterHref` when the open book / `fileData` changes; a leftover href from book A must not go to book B.
- The reader TOC sidebar may stay foliate's nested tree. Only the agent locator and sidecar owned list share `chapterHref` / owned `chapterIndex`.

**Related**: backend quality-guidelines "Scenario: reader/agent chapter coordinates".

**Rules**:
- Reader header title is the book name. Do not put the `Litera` brand in the reader toolbar.
- Do not add a full-width progress bar, hairline, header percentage, or footer page numbers on the reader page. `App` still keeps `progress` state: `index` goes to `ChatPanel` as `currentChapterIndex`; `fraction` persists as `lastFraction`. Visible progress lives on `BookCard`, not in reader chrome.
- TOC is an absolute left drawer over `ReaderView` (backdrop / Esc / chapter click close). Do not insert a `w-56 shrink-0` column beside the reader. `App` may listen for `Escape` to close TOC; do not handle `ArrowLeft` / `ArrowRight` in `App` (ReaderView owns paging on the chapter iframe).
- Mount exactly one `ReaderView`. Keep `ChatPanel` mounted when collapsed (`hidden` + panel collapse). Do not branch two copies of `ReaderView`.
- Chat open size is ~22%. Do not bind `Panel` `defaultSize` / `minSize` to `chatCollapsed` — that re-registers the panel and resets the layout.
- 「问 agent」 while chat is collapsed: store a pending capture, expand the panel, then `fillInput` after layout. Do not call `fillInput` on a `display:none` panel.

**Related**: [State Management](./state-management.md) for process-only `tocVisible` / `chatCollapsed`.

### Convention: chat message action rows reserve height

**What**: User-message edit and assistant-message copy live in a fixed-height row **below** the bubble / markdown (`h-6`). Hover may change icon contrast. Editing replaces that row with save/cancel; the bubble becomes a textarea.

**Why**: `absolute right-1 top-1` overlay buttons sit on the last characters of short user bubbles and on the first line of assistant markdown.

**Wrong**:
```tsx
<div className="group relative">
  <button className="absolute right-1 top-1 opacity-0 group-hover:opacity-100" />
  {message.content}
</div>
```

**Correct**:
```tsx
<div className="rounded-2xl bg-primary px-3 py-2">{message.content}</div>
<div className="flex h-6 items-center justify-end">
  <button type="button" aria-label="编辑" className="text-muted-foreground/50 hover:text-muted-foreground">
    <Pencil className="h-3.5 w-3.5" />
  </button>
</div>
```

### Convention: Settings entry ownership

**What**: General settings and LLM settings are different surfaces with different owners.

| Entry | Owner / state | Surface |
|---|---|---|
| Library gear | `App` `settingsOpen` via `LibraryView.onOpenSettings` | `SettingsDialog` (typography / appearance / AI) |
| Reader toolbar Aa (`aria-label="字体与主题"`) | `App` `settingsOpen` | `SettingsDialog` |
| Chat panel gear / "打开设置" banner | `ChatPanel` local `showConfig` | `AgentConfigDialog` only |

**Why**: Passing a general-settings opener into `ChatPanel` plus `callback?.() ?? fallback()` opened both surfaces on one click (`void` callbacks return `undefined`). A third `view === "settings"` also unmounted the library/reader, so closing settings had to reconstruct the previous page.

**Rule**: Do not add an `onOpenSettings` callback to `ChatPanel`. Chat settings stay local. General settings is a centered `SettingsDialog` overlay (`settingsOpen`); `view` stays `"library" | "reader"` so the current page stays mounted. Closing the dialog must not call `close_book` / `handleBackToLibrary`. Flush failure on close leaves the dialog open. Typography scope is `view === "reader"` (book override) vs library (global defaults).

**Shell**: `SettingsDialog` `DialogContent` is a fixed box (`w-[768px] h-[40rem] max-h-[85vh] sm:max-w-[calc(100%-2rem)]`). Right pane scrolls (`min-h-0 flex-1 overflow-y-auto`). Do not size with max-only classes such as `sm:max-w-3xl` and no explicit height — typography is much taller than appearance, so the box jumps when switching sections.

> **Warning**: shadcn `DialogContent` defaults to `w-full max-w-[calc(100%-2rem)] sm:max-w-lg`. A later `max-w-[calc(100%-2rem)]` does **not** override `sm:max-w-lg`; use `sm:max-w-[calc(100%-2rem)]`. Tests that only `toContain("max-w-[calc(100%-2rem)]")` match the default class and miss a missing `sm:` override.

### Convention: library confirms and selection mode

**What**: Library delete and same-path overwrite use `AlertDialog`. Import/delete failures use an in-page banner. Toolbar「选择」enters selection mode; cover clicks toggle checkboxes and must not open a book. There is no「继续阅读」banner — recency is `list_books` order.

**Why**: `confirm()` / `alert()` block the WebView and do not match the dialog system. Opening a book while an overwrite dialog is open unmounts `LibraryView` and leaves staged imports behind.

**Rules**:
- Disable cover open and duplicate-banner「打开」while `importing`.
- Settle pending overwrite confirms as cancel if `LibraryView` unmounts.
- Gate import (picker + drag-drop) with a synchronous `importingRef`, not only `useState`.
- Process drag-drop files one path at a time (`import_paths([path])` then confirm/commit) so a later file can see a just-committed `contentHash`.

### Don't: `callback?.() ?? fallback()` for optional handlers

**Problem**:
```tsx
onClick={() => onOpenSettings?.() ?? setShowConfig(true)}
```

**Why it's bad**: `setSettingsOpen(true)` returns `undefined`. `??` then still runs `setShowConfig(true)`, so both dialogs open.

**Instead**:
```tsx
onClick={() => setShowConfig(true)}
// or, if a fallback is truly needed:
onClick={() => {
  if (onOpen) onOpen();
  else setShowConfig(true);
}}
```

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

### Gotcha: chapter iframe events do not reach the parent window

> **Warning**: foliate.js renders each section in a sandboxed iframe. Parent `window` does not receive that iframe's `keydown`, `click`, or `wheel`. A host-only keyboard listener looks fine until the user clicks the text, then arrows stop working.
>
> Bind paging on each chapter `doc` from the `foliate-view` `load` CustomEvent (`detail.doc`). Unbind the previous `doc` before binding the next — section changes replace the iframe. Also bind pointer/wheel on the `foliate-view` host so paginator side margins work.
>
> `ReaderView` owns all page-turn input. Do not add a second `window` `keydown` listener in `App.tsx`.
>
> Spatial input (left/right click, arrow keys) uses `goLeft()` / `goRight()` (RTL-aware). Wheel uses reading order: down/right → `next()`, up/left → `prev()`.
>
> Wheel paging is an idle-reset gesture (`consumeWheelDelta` in `src/lib/reader-paging.ts`), matching Readest / Apple Books: accumulate normalized travel, flip once at **30px**, swallow the inertial tail (`flipped`), reset only after **200ms** of silence. Pass `WheelEvent.deltaMode` (`1` → ×40, `2` → ×800) and `timeStamp`. A line-mode mouse notch (`deltaMode === 1`, `delta === 1`) must turn a page.
>
> Do **not**:
> - cover the iframe with left/right overlay hit-boxes (blocks text selection)
> - set `flow="scrolled"` just to get native wheel scrolling (changes the reading model)
> - edit `src/foliate-js/` (git submodule)
> - use a cooldown that **extends on every event** — macOS trackpad inertia keeps that lock alive and the next intentional swipe feels dead
> - ignore `deltaMode` and treat every delta as pixels — line-mode notches never reach a pixel threshold

Helpers live in `src/lib/reader-paging.ts`. Implementation: `src/components/ReaderView.tsx`.

### Display app-data images via convertFileSrc

Images stored in Tauri's app data directory cannot be loaded via plain `file://` URLs (CSP blocks them). Use Tauri's asset protocol:

```typescript
import { convertFileSrc } from "@tauri-apps/api/core"

<img src={convertFileSrc(coverPath)} />
```

Requires `assetProtocol.enable = true` + `scope` in `tauri.conf.json`, and `img-src` CSP must include `asset:` and `http://asset.localhost`.

### Inject font/theme CSS via view.renderer.setStyles

**Problem**: Need to apply reader typography and theme colors to the EPUB content rendered inside foliate.js iframes, persisting across section changes.

**Solution**: Build the stylesheet only in `generateStylesCss` (`src/lib/reader-styles.ts`), then call `view.renderer.setStyles(css)`. The foliate.js Paginator stores the string and reapplies it on every section load (`#onLoad` calls `this.setStyles(this.#styles)`). Do not assemble CSS in `App` or `ReaderView`.

```typescript
const css = generateStylesCss(styleState)
readerRef.current?.setStyles(css)
```

`generateStylesCss` writes `font-family`, `font-size`, `line-height`, `letter-spacing`, `max-width`, `padding-inline`, and `text-align` on `html, body`, plus `p { margin-block-end; text-indent }` with `!important` so EPUB chapter CSS does not win. Each `setStyles` call replaces the full stylesheet (not additive).

`font-family` must go through `cssFontFamily`: generics (`serif` / `sans-serif` / `monospace`) stay unquoted; named faces are quoted/escaped and followed by `, serif`. Do not interpolate a raw user-facing family name into the stylesheet.

The Settings typography font control is a searchable combobox (`Popover` + `Command`), not three `ChoiceButton`s. Put the three generics first, then `list_system_fonts` families. If the saved name is missing from the list, keep it selected and mark it unavailable — do not rewrite the stored value. Set `modal={false}` on the popover so it can open inside `SettingsDialog` without a focus trap. App chrome fonts stay on the theme stylesheet; this picker only affects reader body CSS.

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