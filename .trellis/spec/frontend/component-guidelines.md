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
| `@fontsource-variable/geist` | Self-hosted Geist Variable for **app chrome only** |

### Convention: app chrome is a cool product-tool surface

**What**: Library, reader chrome, chat, and settings share one Linear-like language. Tokens live in `src/index.css` (`:root` / `.dark`). Default chrome type is Geist Variable plus CJK system fallbacks, imported from `src/main.tsx` before `index.css`. Users can override family and root size in Settings → Appearance; the default stack does not change.

**Why**: Default shadcn zinc + system UI + card shadows read as scaffolding. A reader still needs a precise tool shell; book-page type stays user-owned.

**How**:
```tsx
// src/main.tsx — chrome font, Vite-emitted same-origin woff2
import "@fontsource-variable/geist/wght.css";
import "./index.css";
```

```css
/* src/index.css — NOT @theme inline, or utilities inline the stack and ignore runtime overrides */
@theme {
  --font-sans: "Geist Variable", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
}
```

**Rules**:
- Chrome family/size: `src/lib/ui-chrome-font.ts`. Persist `localStorage` `litera.uiFontFamily` / `litera.uiFontSize` (Geist Variable / 16 when unset or invalid). Apply on `document.documentElement` (`--font-sans` + `font-size`) from `main.tsx` after `initLocale()` and live from Appearance. Do not add these keys to `preferences.json`.
- Keep `--font-sans` in a non-inline `@theme` block so `.font-sans` stays `var(--font-sans)`. `@theme inline` bakes the stack into the utility; setting the variable on `html` then does nothing.
- Appearance font picker prepends Geist (`includeGeist`); Typography still starts with the three generics. Do not put Geist in the reader list.
- Do not put Geist (or `--font-sans`) into `generateStylesCss`. Reader body uses the user's `fontFamily`. `reader-styles` tests must reject `Geist` in that CSS. Do not bundle Noto / Source Han for a Chinese default — CJK stays PingFang / YaHei / Noto Sans SC system fallbacks.
- Do not add a Google Fonts CDN. CSP `font-src` is `'self' blob: data:` (see quality-guidelines).
- Elevation is a 1px border or one-step surface shift. Do not put `shadow-sm` / `shadow-md` / `shadow-lg` on cards, the chat composer, TOC/标注 drawers, or dialogs.
- Neutrals stay one cool zinc family (same hue in light and dark). No warm paper/bone canvas, no purple/blue glow, no second accent.
- Library delete is lucide `X` with `useT()` `aria-label`, never emoji `✕`.
- Keep layout geometry from "reader chrome is reading-first". Restyle tokens and surfaces only.

**Related**: frontend `quality-guidelines.md` CSP `font-src`; `reader-styles.ts` `generateStylesCss`.

### Installed shadcn components

`src/components/ui/` holds the shadcn components copied into the project. Current set:

- `button.tsx` — all toolbar/action buttons (icon variants via lucide)
- `dialog.tsx` — modal overlays (used by `AgentConfigDialog` and `SettingsDialog`)
- `alert-dialog.tsx` — destructive confirms (library delete / overwrite / custom provider delete)
- `select.tsx` — dropdown selectors (used by `AgentConfigForm` provider picker)
- `slider.tsx` — continuous typography controls on `SettingsDialog`
- `popover.tsx` + `command.tsx` — searchable combobox (reader font picker; custom LLM model picker)
- `input.tsx` — text/password inputs
- `label.tsx` — form labels

**Rule**: New modals and form fields must use these shadcn components, not native `<select>`/`<input>`/`<label>`/hand-written overlay divs. Add more via `npx shadcn@latest add <name>` when needed. `alert-dialog.tsx` may match the existing `dialog.tsx` Radix style if the CLI add fails; do not use `window.confirm()` / `window.alert()`.

**Select grouping**: use `SelectGroup` + `SelectLabel` + `SelectSeparator` for grouped options; do not emulate separators with disabled `<option>` values. Special pseudo-options (e.g. "add new…") are regular `SelectItem`s with sentinel string values handled in `onValueChange`.

### Convention: LLM provider dropdown is draft-only

**What**: `AgentConfigForm` splits 「当前使用」and 「这个提供商」. Changing the provider Select only updates local draft state. Disk writes and embedded-runtime cache invalidation happen on 「保存并应用」 (`save_agent_config` for built-in, optional `update_custom_provider` + `switch_provider` for custom). 「添加自定义」is a button, not a Select sentinel. Custom provider delete uses `AlertDialog`.

Custom (and the add form) model field is a local searchable combobox (`Popover` + `Command`, `modal={false}`): pick from the draft catalog, type a new id via 「使用 {id}」 (append + select), refresh beside the box. Refresh is custom/add-form only and calls `list_remote_models`; it must not write agent JSON or invalidate the active runtime. The catalog only grows — no per-model delete, no second `ModelListEditor` under 「这个提供商」. Built-in model stays a plain text input with no refresh and no catalog.

**Why**: Select-on-change used to switch the live provider mid-chat. Splitting pick / type / refresh across two sections made custom model changes unlike typical LLM apps. Built-in brands have no reliable `/models` catalog, so they stay free-text.

**Don't**: Put add-custom back in the Select. Don't call `switch_provider` from `onValueChange`. Don't fetch `/models` from the WebView. Don't add a model-list editor or per-id delete. Don't share the model combobox module with the font picker (create-new vs fixed list). Don't show refresh on built-in providers.

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

**What**: Two modes share one shell. Reader mode is book-title + always-visible progress scrubber + overlay TOC + overlay 标注 + on-demand chat (starts collapsed). Agent mode is ChatGPT-like: session rail + main chat + full side reader. TOC and 标注 are never extra columns — they overlay the **book cell**. Factory default and books with no memory open in reader mode.

**Why**: A fixed TOC column and a default 35% chat pane make the book a side panel. Toggling chat **or mode** by remounting `ReaderView` / `ChatPanel` reopens the EPUB and breaks `fillInput`. The scrubber shows chapter + percent and jumps via `goToFraction`. Percent does not live in the header icon cluster; library cards still show `lastFraction`.

**Layout**:
```
header (reader): [mac inset?] [←][TOC][标注]  book title (drag)  [spacer drag]  [Aa] | [mode][chat]  [Win/Linux window buttons]
header (agent):  [mac inset?] [←]  book title (drag)  [spacer drag]  [Aa] | [TOC][标注] [mode][book]  [Win/Linux window buttons]
book:     [ ReaderView canvas + overlay TOC/标注 ]
          [ ‹章  chapter    ====●==|==|====   42%  章› ]
reader:   [ book 1fr | chat 22% or 0 ]
agent:    [ chat (rail 240px + messages) | book 38% or 0 ]
```

Same two CSS-grid children (`grid-area: book` / `chat`). Mode only changes `grid-template-areas` (`"book chat"` vs `"chat book"`) and column sizes. Do not render a second `ReaderView` or `ChatPanel`.

### Convention: TOC current row stays in the list viewport

**What**: `TocSidebar` highlights the row whose `href` equals `currentHref`. On mount and whenever `currentHref` changes to another match, compare that row and the list (`flex-1 overflow-y-auto`) with `getBoundingClientRect`. If the row's full height is inside the list rect, do not scroll. If it is outside or clipped, set `list.scrollTop` so the row is vertically centered (clamped by scroll range near the ends). No match or no `currentHref`: do not scroll.

**Why**: The drawer remounts on every open (`{tocVisible && <TocSidebar />}`). Long TOCs hide the highlight below the fold. `scrollIntoView({ block: "nearest" })` only scrolls until the row is barely visible, so later chapters pin to the bottom edge. Unconditional `scrollIntoView({ block: "center" })` recenters even when the row is already fully visible (user may have scrolled the list, or the next chapter is already on screen). Adjusting `list.scrollTop` only moves the list, not the outer drawer or page.

**Don't**:
```ts
row.scrollIntoView({ block: "nearest", behavior: "auto" }); // pins current to the bottom
row.scrollIntoView({ block: "center", behavior: "auto" });  // jumps even when already in view
```

**Instead**:
```ts
if (rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom) return;
list.scrollTop +=
  (rowRect.top + rowRect.bottom - listRect.top - listRect.bottom) / 2;
```

**Don't**: Scroll the outer drawer. Use `smooth`. Change href matching (still `item.href === currentHref`) as part of a scroll tweak. Pin the TOC as a third column. Trust jsdom's default `getBoundingClientRect` (all zeros) — TOC scroll tests must mock list vs row geometry.

**Related**: `src/components/TocSidebar.tsx`; overlay TOC in "reader chrome is reading-first".

### Convention: window chrome merges into existing headers

**What**: There is no second titlebar. Library and reader headers are `h-12` via `titlebarClassName()`. macOS keeps system traffic lights and adds `pl-[72px]`; Windows / Linux render `WindowControls` on the far right.

**Why**: A dedicated titlebar steals reading height. Shared `"decorations": false` would drop macOS traffic lights.

**Rules**:
- Use `titlebarClassName()` / `onTitlebarDragMouseDown` / `WindowControls` from `src/components/WindowControls.tsx`. Do not fork a second chrome row.
- `data-tauri-drag-region` + `select-none` only on the title and the flex spacer. Never on the header root, search, or buttons.
- Custom close calls `close()`, not `destroy()`.
- Window buttons are `Button` `icon-sm` `ghost` + lucide (`Minus` / `Square` / `X`) with `useT()` aria-labels (`window.minimize` / `window.maximize` / `window.close`).
- Detect OS with `src/lib/platform.ts` (`navigator.userAgent`). Do not add `@tauri-apps/plugin-os`.
- Maximize button stays `Square` / "maximize"; do not add `isMaximized` restore-icon state unless a later task asks.

**Related**: frontend `quality-guidelines.md` "main window chrome (no OS title bar)".

### Convention: chat locator is a chapter href, not a spine index

**What**: `ReaderView` relocate / selection capture a `chapterHref` (`tocItem.href` if truthy, else `book.sections[index].id`) and pass it through `App` → `ChatPanel` → `agent_prompt` / `agent_edit_prompt`. Empty string is not a locator — fall back to section `id`, then omit.

**Why**: Foliate `relocate.detail.index` is a spine file. Sidecar tools use a TOC-owned chapter list. Sending the integer made the aside say "第 N 章" for the wrong object.

**Rules**:
- Do not send `chapterIndex` on the live prompt path (`PromptContext` is `deny_unknown_fields`).
- Clear `chapterHref` when the open book / `fileData` changes; a leftover href from book A must not go to book B.
- The reader TOC sidebar may stay foliate's nested tree. Only the agent locator and worker-owned list share `chapterHref` / owned `chapterIndex`.

**Related**: backend quality-guidelines "Scenario: reader/agent chapter coordinates".

**Rules**:
- Reader header title is the book name. Do not put the `Litera` brand in the reader toolbar. Reader and library titles are `text-sm font-medium`, not `text-lg font-semibold`.
- The book cell is full-bleed: `ReaderView` fills the area above the progress bar. Do not wrap it in `bg-muted/40` or a `p-3` inset, and do not add a paper well or inner border. Do not paint warm paper on app chrome, and do not put Geist into `generateStylesCss`.
- The only page/chrome seam under the book is the progress bar's `border-t`. When the side pane is open, put `border-l` on the visible right-hand cell (reader: chat; agent: book). Do not paint the 6px resize handle as the seam, and do not put `border-l` on a hidden/collapsed cell.
- Docked `ChatPanel` (`variant="docked"`) has no header `border-b` — the window titlebar already supplies that line. Workspace keeps `border-b`. TOC / 标注 drawer titles are `flex h-12 items-center border-b px-3 text-sm font-medium`, not `py-3`.
- Flatten TOC and prev/next chapter via `src/lib/toc-items.ts` (`flattenToc`, `chapterNavAt`). `ReaderViewHandle.getSectionFractions` / `previewLabelAt` wrap the mounted foliate-view. Do not import `src/foliate-js/progress.js` into React, and do not walk the TOC tree inline in `App`.
- Progress is always visible at the **bottom of the book cell** in both modes. Do not mount it under the header or stretch it across chat. Click seeks immediately; drag updates a local draft (thumb, fill, preview) and seeks on release. Map pointer x / width with `fractionFromPointer` and wrap seeks in `createLatestSerializedTaskController` (latest-wins). Section ticks come from `readerRef.getSectionFractions()`. Prev/next chapter walk the flattened TOC by `chapterHref` via `goToTocItem` — not previous/next page. Do not put percent in the header icon cluster, and do not add hover-only bars, remaining-time, or footer page numbers. `App` still keeps `progress` as relocate state: `chapterHref` goes to `ChatPanel`; `fraction` persists as `lastFraction`. Library-card percent stays on `BookCard`.
- TOC is an absolute left drawer over `ReaderView` (backdrop / Esc / chapter click close). Do not insert a `w-56 shrink-0` column beside the reader. If the Agent book cell is collapsed, opening TOC/标注 must expand the book first. `App` may listen for `Escape` to close TOC; do not handle `ArrowLeft` / `ArrowRight` in `App` (ReaderView owns paging on the chapter iframe). The drawer width is user-resizable via a right-edge drag handle (pointer events, `cursor-col-resize`, `hover:bg-primary/30`) and persisted to `localStorage` key `toc-sidebar-width` (default 224px, min 160px, clamped to the reader container). Width helpers live in `src/lib/toc-sidebar-width.ts`; do not hardcode `w-56` on the TOC drawer.
- 标注 is the same overlay chrome as TOC (`w-56`, backdrop, Esc). TOC / 标注 are book-owned: they follow the book pane, not the window's left edge. Reader: immediately after back, left of the title. Agent: after the 1px rule, immediately before mode + book. Aa stays left of the rule in both modes. Share one button pair / one set of handlers; do not fork click logic per mode. Agent sessions toggle lives only in `ChatPanel`. Opening 标注 closes TOC and vice versa. The open flag is process-only (`annotationsVisible` in `App`); do not persist it. Clicking a list row jumps then closes the drawer. Do not remount `ReaderView` when toggling either drawer. 标注 keeps its fixed `w-56`; only TOC is resizable.
- Mount exactly one `ReaderView` and one `ChatPanel`. Keep both mounted when a pane is collapsed (`hidden` + width 0). Do not branch two copies. Do not swap them between two `Group` trees — that remounts. Session rail in Agent mode is a flex sibling **inside** `ChatPanel` (`variant="workspace"`, ~240px, not `absolute` overlay). Docked/reader chat keeps the overlay list. Clear the overlay flag when entering workspace.
- Chat open size is ~22% (`litera.chat-panel-width`). Agent book open size is ~38% (`litera.agent-book-width`, clamp 22–60). Session rail width is fixed. Do not bind layout default/min size to collapse flags. Session-rail / book / chat collapsed flags are process-only; re-entering Agent mode opens the rail and the book.
- Mode resolution: book `lastReaderMode` → `localStorage` `litera.defaultReaderMode` → `"reader"`. Toolbar switch persists via `update_reading_state({ lastReaderMode })`. Settings default writes localStorage only — never `preferences.json`, never a library patch. Helpers: `src/lib/reader-mode.ts`.
- 「问 agent」 while reader-mode chat is collapsed: store a pending capture, expand the panel, then `fillInput` after layout. Do not call `fillInput` on a `display:none` panel. In Agent mode the chat cell is visible — `fillInput` immediately. Opening TOC/标注 while the book cell is hidden expands the book.

**Related**: [State Management](./state-management.md) for process-only `tocVisible` / `chatCollapsed` / rail and book collapse. Backend `tauri-commands.md` "Scenario: lastReaderMode".

### Convention: chat auto-scroll respects user position (stick-to-bottom)

**What**: Streaming assistant messages must not yank the scroll position back to the bottom. `ChatPanel` keeps a `stickToBottom` state (initial `true`); the message container's `onScroll` computes `scrollHeight - scrollTop - clientHeight` and flips it `false` once the user scrolls up beyond a ~48px threshold, `true` when they return. The `[state.messages]` auto-scroll effect only runs `scrollIntoView({ behavior: "smooth" })` while `stickToBottom` is `true`. Explicit user intent (send, edit re-send, session switch / new session via `state.sessionId` effect) calls `scrollToBottom()` which re-enables following and scrolls down.

**Why**: Unconditional `scrollIntoView` on every streamed chunk makes reading earlier content impossible — the viewport is continuously dragged to the latest token.

**Rules**:
- Track stickiness with a state flag, not by reading scroll metrics inside the auto-scroll effect — growth of `scrollHeight` during streaming doesn't fire scroll events, so appending messages never falsely clears the flag; only real user scrolls update it.
- Reset stickiness only on explicit user intent (send / edit / session change), not on stream end.
- The 48px threshold is a local constant; keep it in `ChatPanel`.

**Related**: `src/components/chat/ChatPanel.tsx`.

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
| Library gear | `App` `settingsOpen` via `LibraryView.onOpenSettings` | `SettingsDialog` (typography / appearance / AI / about) |
| Reader toolbar Aa (`aria-label="字体与主题"`) | `App` `settingsOpen` | `SettingsDialog` |
| Chat panel gear / "打开设置" banner | `ChatPanel` local `showConfig` | `AgentConfigDialog` only |

**Why**: Passing a general-settings opener into `ChatPanel` plus `callback?.() ?? fallback()` opened both surfaces on one click (`void` callbacks return `undefined`). A third `view === "settings"` also unmounted the library/reader, so closing settings had to reconstruct the previous page.

**Rule**: Do not add an `onOpenSettings` callback to `ChatPanel`. Chat settings stay local. General settings is a centered `SettingsDialog` overlay (`settingsOpen`); `view` stays `"library" | "reader"` so the current page stays mounted. Closing the dialog must not call `close_book` / `handleBackToLibrary`. Flush failure on close leaves the dialog open. Typography scope is `view === "reader"` (book override) vs library (global defaults).

**Shell**: `SettingsDialog` `DialogContent` is a fixed box (`w-[768px] h-[40rem] max-h-[85vh] sm:max-w-[calc(100%-2rem)]`). Right pane scrolls (`min-h-0 flex-1 overflow-y-auto`). Do not size with max-only classes such as `sm:max-w-3xl` and no explicit height — typography is much taller than appearance, so the box jumps when switching sections.

> **Warning**: shadcn `DialogContent` defaults to `w-full max-w-[calc(100%-2rem)] sm:max-w-lg`. A later `max-w-[calc(100%-2rem)]` does **not** override `sm:max-w-lg`; use `sm:max-w-[calc(100%-2rem)]`. Tests that only `toContain("max-w-[calc(100%-2rem)]")` match the default class and miss a missing `sm:` override.

### Convention: settings exclusive choices are a segmented control

**What**: Theme, language, and text-align in `SettingsDialog` share a local `SegmentedControl` (`src/components/settings/SettingsDialog.tsx`). Layout is label above, control full width (`PresetRow`). The track is `bg-muted`; the selected segment is `bg-background shadow-xs`. The group is `role="radiogroup"`; each option is `role="radio"` with `aria-checked`. Arrow keys move focus; Space / Enter select.

**Why**: Separate bordered `ChoiceButton`s read as three action buttons, not one exclusive choice. A filled `bg-primary` selected state looks like a CTA. `src/components/ui/` is shadcn-owned — do not drop this control there, and do not add `toggle-group` just for these three rows.

**Don't**:
- Rebuild these rows as independent `rounded border` buttons with `gap-1`.
- Use `bg-primary text-primary-foreground` for the selected segment.
- Change the left nav (排版 / 外观 / AI / 关于) into a segmented control — that is a category list.
- Put `locale` on `preferences.json` when touching the language row (see `i18n.md`).

**Tests**: Query these options as `radio`, not `button`. Assert the group name and the current value's `aria-checked`.

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

### Gotcha: re-opening a book without close() stacks renderers

> **Warning**: `foliate-view.open()` creates a new `foliate-paginator` and appends it to the shadow root **without removing the previous one**; only `close()` calls `renderer.destroy()` + `renderer.remove()`. Calling `open()` twice on the same element (e.g. a repeated `setFileData` in the reader) stacks two full-height paginators: the visible one is the first book, while paging (`next()` / `prev()`) acts on the second, off-screen one — pages appear to not turn.
>
> **Correct**: call `view.close?.()` before `view.open(file)` in the open effect. `close()` is synchronous, so there is no race with the async `open()`. See `src/components/ReaderView.tsx`.
>
> Do **not** patch `src/foliate-js/` (git submodule) to make `open()` self-cleaning — defend at the call site.

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
> - hit-test iframe clicks with `doc.defaultView.innerWidth`, root `clientWidth`, or raw `clientX` (see next gotcha)

Helpers live in `src/lib/reader-paging.ts`. Implementation: `src/components/ReaderView.tsx`.

### Gotcha: iframe click X is chapter-strip local, not the visible page

> **Warning**: In paginated mode foliate's paginator expands the chapter iframe to `pageCount * pageSize`. `#container` then `scrollLeft`s to show one spread. `html` CSS `width` is one spread (`pageSize`). `window.innerWidth` and **root** `document.documentElement.clientWidth` are both the **whole strip**: CSSOM special-cases the root, so `clientWidth` is the iframe viewport, not the CSS width on `<html>`. `PointerEvent.clientX` is measured from the left of the strip.
>
> Using `hitFromClientX(clientX, innerWidth)` or `pageLocalX(clientX, documentElement.clientWidth)` looks fine on a 1-page section and wrong on a long one: early pages all hit **left**, middle pages **middle** (no turn), late pages all **right**. Crossing into the next chapter resets the strip, so the same screen click flips from **next** to **prev**. Host gutter clicks (relative to `foliate-view` `clientWidth`) are a different coordinate space and stay correct — that node is not a document root.
>
> **Wrong**:
> ```ts
> hitFromClientX(ev.clientX, doc.defaultView.innerWidth)
> hitFromClientX(ev.clientX, doc.documentElement.clientWidth) // root clientWidth === viewport === strip
> pageLocalX(ev.clientX, doc.documentElement.clientWidth)     // no-op on long chapters
> hitFromClientX(hostLocalX, host.clientWidth)                // wide window: text sits in the middle third
> ```
>
> **Correct**:
> ```ts
> const pageWidth = pageWidthOf(doc) // html getBoundingClientRect().width, not clientWidth
> hitFromClientX(pageLocalX(ev.clientX, pageWidth), pageWidth)
> ```
>
> `pageWidthOf` is the `<html>` layout width (`getBoundingClientRect().width` / `offsetWidth`). `pageLocalX` is positive modulo (`((x % w) + w) % w`); `pageWidth <= 0` returns `0` so `hitFromClientX` yields `"middle"`. Click zones are the visible spread, not the full reader chrome. Do not query `#container` from outside — `Paginator` uses a closed shadow root.

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

The Settings font control is a searchable combobox (`Popover` + `Command`), not a segmented control. Theme / language / text-align stay on `SegmentedControl` (see "settings exclusive choices" above). Typography: three generics first, then `list_system_fonts`. Appearance chrome: Geist first (`includeGeist`), then the same generics + system list. If the saved name is missing from the list, keep it selected and mark it unavailable — do not rewrite the stored value. Set `modal={false}` on the popover so it can open inside `SettingsDialog` without a focus trap. One picker component; do not fork a second combobox. Typography writes reader `fontFamily` only. Chrome writes `litera.uiFontFamily` + `applyUiChrome`.

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
