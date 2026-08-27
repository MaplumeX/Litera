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
- `dropdown-menu.tsx` + `context-menu.tsx` — library book actions (⋮ and right-click share Open / Details / Delete)
- `select.tsx` — dropdown selectors (used by `AgentConfigForm` provider picker, library sort)
- `slider.tsx` — Appearance chrome font size on `SettingsDialog` (typography continuous fields use `−` / `Input` / `+`, not this slider)
- `popover.tsx` + `command.tsx` — searchable combobox (reader font picker; custom LLM model picker)
- `input.tsx` — text/password inputs
- `textarea.tsx` — multiline text (book details description)
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

**Why**: A fixed TOC column and a default 35% chat pane make the book a side panel. Toggling chat **or mode** by remounting `ReaderView` / `ChatPanel` reopens the EPUB and breaks `fillInput`. The scrubber shows chapter + percent and jumps via `goToFraction`. Percent does not live in the header icon cluster; library cards still show `lastFraction`. Reopening a book restores via `init({ lastLocation: lastCfi })`, not `goToFraction`.

**Layout**:
```
header (reader): [mac inset?] [←][TOC][标注]  book title (drag)  [spacer drag]  [Aa][TTS] | [mode][chat]  [Win/Linux window buttons]
header (agent):  [mac inset?] [←]  book title (drag)  [spacer drag]  [Aa][TTS] | [TOC][标注] [mode][book]  [Win/Linux window buttons]
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

### Convention: TOC nested collapse uses path keys in App

**What**: Parent TOC rows collapse. `App` holds `tocExpanded: string[]` (sibling-index path keys such as `"0.2.1"`). `TocSidebar` receives `expanded` / `onToggle` / `onExpandAll` / `onCollapseAll`. Chevron toggles expand only. Title click with a non-empty href still `onGoTo` (drawer still closes). Empty href is not a navigation control and must not call `goTo("")`.

**Why**: The drawer remounts on every open, so expand state cannot live only in `TocSidebar`. EPUB hrefs repeat and can be empty, so keys cannot be hrefs. `currentHref` often arrives after `setToc`; first relocate must still reveal the current row.

**How**:
```ts
setToc(bookToc);
setTocExpanded(ancestorKeysForHref(bookToc, progressRef.current.chapterHref));
// later currentHref:
setTocExpanded((current) =>
  unionKeys(current, ancestorKeysForHref(toc, progress.chapterHref)),
);
```

**Rules**:
- Helpers live in `src/lib/toc-items.ts`: `tocPathKey`, `collapsibleKeys`, `ancestorKeysForHref`, `unionKeys`. Do not walk the tree inline in `App`.
- `ancestorKeysForHref` returns collapsible **ancestors** of every `item.href === href` match, not the matching row. Missing/unmatched href → `[]` (all collapsed).
- On `setToc(bookToc)` apply current-path ancestors. When `chapterHref` changes, **union** those keys; do not auto-collapse extra expansions.
- Expand-all = `collapsibleKeys(toc)`. Collapse-all = `ancestorKeysForHref(toc, chapterHref)` (current path only, not a fully closed tree).
- Reset `tocExpanded` wherever `setToc([])` / back-to-library runs. Closing the drawer must not reset it.
- Do not persist expand state (`localStorage`, `preferences.json`, `update_reading_state`).
- Split chevron and title — no nested `<button>`. Leaf rows use a `w-6` spacer. Title bar stays `h-12`; expand-all / collapse-all are `icon-xs` ghost (`ChevronsUpDown` / `ChevronsDownUp`) with `toc.expandAll` / `toc.collapseAll`.
- Render `subitems` only when the parent key is in `expanded`. Nested flags under a collapsed parent stay in the array.
- Keep current-row highlight + list-viewport centering. Prev/next still uses `flattenToc` / `chapterNavAt` and ignores expand state.

**Don't**:
```ts
expanded.has(item.href);          // hrefs collide and can be empty
{tocVisible && <TocSidebar />}    // expand state inside the sidebar — remount wipes it
setTocExpanded(ancestorKeysForHref(toc, href)); // on chapter change — drops extra expansions
```

**Related**: overlay TOC + current-row viewport conventions; frontend `state-management.md` (`tocExpanded` is process-only).

### Convention: reader TTS is Web Speech + a reserved overlay

**What**: In-reader read-aloud lives in `useReaderTts` + `ReaderView` + `ReaderTtsBar`. The header has one play/pause icon. A bar appears above `ReaderProgressBar` only while `status !== "idle"`. Rate/voice persist as `localStorage` `litera.ttsRate` / `litera.ttsVoice`.

**Why**: foliate-js `TTS` returns SSML and does not speak. `preferences.json` `deny_unknown_fields` would reset theme if TTS keys were added there. Default `initTTS` highlight uses `scrollToAnchor(range, true)` and opens the selection toolbar.

**How**:
```ts
await view.initTTS("sentence", drawLiteraTtsHighlight);
// parse SSML marks → one SpeechSynthesisUtterance per sentence
// utterance.onstart → view.tts.setMark(name)
overlayer.add("litera-tts", range, Overlayer.highlight, { color: TTS_HIGHLIGHT_COLOR });
scrollToAnchor(range, false); // only if off-screen
```

**Rules**:
- Do not edit `src/foliate-js/**`. Type `initTTS` / `TTS` in `src/foliate-js.d.ts`.
- Do not feed foliate SSML to `utterance.text`. Parse `<mark>` and speak plain text.
- Pause with `speechSynthesis.cancel()` plus a leftover queue. Do not rely on `pause()`.
- Treat `canceled` / `interrupted` as expected after `cancel()`, not as AC10 failures.
- Overlay key is `litera-tts`, never a CFI. Never `addAnnotation` for follow highlight.
- Space play/pause binds in `ReaderView` (window + iframe). Ignore BUTTON / slider in addition to `shouldIgnorePagingTarget`.
- Stop on back-to-library, book change, unmount, and `bookHidden`. User relocate while speaking restarts from the new visible range.
- No TTS button on `SelectionToolbar`. No Media Overlay path this feature.

**Related**: frontend `i18n.md` (do not add TTS keys to `preferences.json`); `src/lib/reader-tts.ts`.

### Convention: window chrome merges into existing headers

**What**: There is no second titlebar. Library and reader headers are `h-12` via `titlebarClassName()`. macOS keeps system traffic lights and adds `pl-[72px]`; Windows / Linux render `WindowControls` on the far right.

**Why**: A dedicated titlebar steals reading height. Shared `"decorations": false` would drop macOS traffic lights.

**Rules**:
- Use `titlebarClassName()` / `useTitlebarWindowDrag()` / `WindowControls` from `src/components/WindowControls.tsx`. Do not fork a second chrome row.
- `data-titlebar-drag` + `select-none` + the hook's pointer props only on the title and the flex spacer. Never on the header root, search, or buttons. Do not put `data-tauri-drag-region` on those nodes (native drag on first down races double-click maximize).
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
- Flatten TOC and prev/next chapter via `src/lib/toc-items.ts` (`flattenToc`, `chapterNavAt`). Nested collapse keys also live there (`tocPathKey`, `collapsibleKeys`, `ancestorKeysForHref`, `unionKeys`). `ReaderViewHandle.getSectionFractions` / `previewLabelAt` wrap the mounted foliate-view. Do not import `src/foliate-js/progress.js` into React, and do not walk the TOC tree inline in `App`.
- Progress is always visible at the **bottom of the book cell** in both modes. Do not mount it under the header or stretch it across chat. Click seeks immediately; drag updates a local draft (thumb, fill, preview) and seeks on release. Map pointer x / width with `fractionFromPointer` and wrap seeks in `createLatestSerializedTaskController` (latest-wins). Section ticks come from `readerRef.getSectionFractions()`. Prev/next chapter walk the flattened TOC by `chapterHref` via `goToTocItem` — not previous/next page. Do not put percent in the header icon cluster, and do not add hover-only bars, remaining-time, or footer page numbers. `App` still keeps `progress` as relocate state: `chapterHref` goes to `ChatPanel`; `fraction` persists as `lastFraction` (percent). The reopen locator is `lastCfi`: `ReaderView` must `init({ lastLocation: cfi })` — do not `init({})` then `goTo(cfi)` (`init` without `lastLocation` calls `next()`). Library-card percent stays on `BookCard`.
- TOC is an absolute left drawer over `ReaderView` (backdrop / Esc / chapter click close). Do not insert a `w-56 shrink-0` column beside the reader. If the Agent book cell is collapsed, opening TOC/标注 must expand the book first. `App` may listen for `Escape` to close TOC; do not handle `ArrowLeft` / `ArrowRight` in `App` (ReaderView owns paging on the chapter iframe). The drawer width is user-resizable via a right-edge drag handle (pointer events, `cursor-col-resize`, `hover:bg-primary/30`) and persisted to `localStorage` key `toc-sidebar-width` (default 224px, min 160px, clamped to the reader container). Width helpers live in `src/lib/toc-sidebar-width.ts`; do not hardcode `w-56` on the TOC drawer. Nested expand state is `App.tocExpanded` (path keys, process-only); see “TOC nested collapse uses path keys in App”. Title click still closes the drawer; chevron click must not.
- 标注 is the same overlay chrome as TOC (`w-56`, backdrop, Esc). TOC / 标注 are book-owned: they follow the book pane, not the window's left edge. Reader: immediately after back, left of the title. Agent: after the 1px rule, immediately before mode + book. Aa stays left of the rule in both modes. Share one button pair / one set of handlers; do not fork click logic per mode. Agent sessions toggle lives only in `ChatPanel`. Opening 标注 closes TOC and vice versa. The open flag is process-only (`annotationsVisible` in `App`); do not persist it. Clicking a list row jumps then closes the drawer (does not open the in-page editor). Do not remount `ReaderView` when toggling either drawer. 标注 keeps its fixed `w-56`; only TOC is resizable. Sidebar rows show a color swatch and a note summary; color/note editing is the host `HighlightEditor` over the book, not a second form in the drawer. Selection toolbar stays 「高亮」then「问 agent」— one-click highlight, then click the painted mark to edit.
- Mount exactly one `ReaderView` and one `ChatPanel`. Keep both mounted when a pane is collapsed (`hidden` + width 0). Do not branch two copies. Do not swap them between two `Group` trees — that remounts. Session rail in Agent mode is a flex sibling **inside** `ChatPanel` (`variant="workspace"`, ~240px, not `absolute` overlay). Docked/reader chat keeps the overlay list. Clear the overlay flag when entering workspace.
- Chat open size is ~22% (`litera.chat-panel-width`). Agent book open size is ~38% (`litera.agent-book-width`, clamp 22–60). Session rail width is fixed. Do not bind layout default/min size to collapse flags. Session-rail / book / chat collapse is per-book `lastLayout` via `update_reading_state`; widths stay global `localStorage`. Switching Reader ↔ Agent must not force-open the rail or book. Missing `lastLayout` uses `{ chatCollapsed: true, bookCollapsed: false, sessionRailOpen: true }`. Helpers: `src/lib/reader-layout.ts`.
- Mode resolution: book `lastReaderMode` → `localStorage` `litera.defaultReaderMode` → `"reader"`. Toolbar switch persists via `update_reading_state({ lastReaderMode })`. Settings default writes localStorage only — never `preferences.json`, never a library patch. Helpers: `src/lib/reader-mode.ts`.
- 「问 agent」 while reader-mode chat is collapsed: store a pending capture, expand the panel, then `fillInput` after layout. Do not call `fillInput` on a `display:none` panel. In Agent mode the chat cell is visible — `fillInput` immediately. Opening TOC/标注 while the book cell is hidden expands the book; the resulting `bookCollapsed: false` is the last layout and is persisted.

**Related**: [State Management](./state-management.md) for process-only `tocVisible` / `tocExpanded` / `annotationsVisible` vs durable `lastLayout`. Backend `tauri-commands.md` "Scenario: lastReaderMode", "Scenario: lastLayout", and "Scenario: lastCfi".

### Convention: chat auto-scroll respects user position (stick-to-bottom)

**What**: Streaming assistant messages must not yank the scroll position back to the bottom. `ChatPanel` keeps a `stickToBottom` state (initial `true`); the message container's `onScroll` computes `scrollHeight - scrollTop - clientHeight` and flips it `false` once the user scrolls up beyond a ~48px threshold, `true` when they return. The `[state.messages]` auto-scroll effect only runs `scrollIntoView({ behavior: "smooth" })` while `stickToBottom` is `true` **and** `isStreaming` is `true`. Explicit user intent (send, edit re-send) calls `scrollToBottom()` (smooth); session switch / new session via the `state.sessionId` effect calls `scrollToBottom(false)`, which sets `scrollTop = scrollHeight` directly — an instant jump with no animation.

**Why**: Unconditional `scrollIntoView` on every streamed chunk makes reading earlier content impossible — the viewport is continuously dragged to the latest token. And a smooth scroll on session enter animates from the top of the freshly replaced message list to the bottom (the reducer swaps the whole `messages` array in one event, so the container starts at `scrollTop` 0) — the longer the history, the longer the visible top-to-bottom sweep.

**Rules**:
- Track stickiness with a state flag, not by reading scroll metrics inside the auto-scroll effect — growth of `scrollHeight` during streaming doesn't fire scroll events, so appending messages never falsely clears the flag; only real user scrolls update it.
- Reset stickiness only on explicit user intent (send / edit / session change), not on stream end.
- The 48px threshold is a local constant; keep it in `ChatPanel`.
- Session enter / switch must jump instantly (`scrollTop = scrollHeight`), never smooth-scroll. Smooth scrolling is reserved for streaming updates and explicit send / edit actions.

**Related**: `src/components/chat/ChatPanel.tsx`.

### Convention: chat user-message outline is a workspace rail

**What**: Agent `ChatPanel` (`variant="workspace"`) derives a conversation outline from the current session's user messages and renders it as `ChatOutlineRail`: a quiet left-edge tick rail over the message column. Each tick is one user prompt. The attended tick (hover after intent delay, or keyboard focus) shows a 2-line preview to its right. Reader/docked chat has no outline UI.

**Why**: Long Agent sessions need prompt jumps without a permanent extra column and without a dimmed overlay. Paseo-style ticks stay out of the way until the pointer is on the rail. Docked chat is too narrow for that rail, so the outline is workspace-only. Deriving items from `state.messages` keeps them in sync with prompt edits and session rewinds without a persistence or protocol contract.

**Rules**:
- Include only `role === "user"`; do not persist outline items or mix in assistant/tool/compaction entries. Preview via `userMessagePreview()` (collapse whitespace, 60 characters).
- Mount the rail only when `variant === "workspace"` and there are ≥2 user messages (`showOutlineRail`). `variant="docked"` must not render a header outline button, rail, or overlay at any width.
- Overlay the rail on the message-column gutter (`absolute left-0 w-9`, top/bottom ~10%), not under the session rail and not over `ChatInput`. Litera has no Paseo-style wide centered column, so when the rail is mounted the scroll area uses `py-3 pr-3 pl-12` (36px rail + 12px gap). When the rail is hidden, keep `p-3`. Do not pad the header or composer. Do not turn the rail into a flex column.
- Slots use `basis-2 grow-0 shrink` and the rail uses `justify-center`. Do **not** `flex-1` the slots: that stretches two or three ticks across the full rail height, so index-distance dock magnification (radius 3) looks like every tick is hovering. Long conversations still shrink below 8px.
- Hover tracking lives on the slot; press lives on the inner control. Do not put hover on a control that resizes under the pointer. First rail entry waits ~150ms (`createChatOutlineHoverIntent`); after activation, moving between ticks is immediate. Leave clears the preview.
- Dock-style local magnification around the attended index; `prefers-reduced-motion` disables it. Preview uses a 1px border / surface token — no `shadow-*`.
- Keep user-message DOM refs keyed by the original message-array index. Active tick = last user message at or above a small probe below the scroll container's top; if none has crossed it, use the first user message. Mark it `aria-current="location"`.
- A tick click is explicit reading intent: set `stickToBottom` false, `scrollIntoView({ behavior: "smooth", block: "start" })`, and do **not** unmount the rail. Reconcile bottom stickiness on `scrollend`, with a short timeout fallback; clear that timer on session/book changes, explicit bottom scrolls, and unmount.
- Remount the rail on `bookId` / `sessionId` so hover/focus preview cannot leak. No Appearance toggle and no 918px hide gate (workspace already splits with the book).
- Rail and ticks use `useT()` labels (`chat.messageToc`, `chat.messageTocItem`) in both catalogs.

```tsx
target.scrollIntoView({ behavior: "smooth", block: "start" });
// scrollend (or the fallback timer) then recomputes whether bottom-follow resumes.
```

**Wrong**:
```tsx
<nav className="absolute top-[10%] bottom-[10%] left-0 flex w-9 flex-col">
  <div className="relative flex min-h-0 flex-1 items-stretch" />
</nav>
<div className="h-full overflow-y-auto p-3" />
```

**Correct**:
```tsx
<nav className="absolute top-[10%] bottom-[10%] left-0 z-10 flex w-9 flex-col justify-center">
  <div className="relative flex min-h-0 w-full basis-2 grow-0 shrink items-center justify-center" />
</nav>
<div className="h-full overflow-y-auto py-3 pr-3 pl-12" />
```

**Tests required**: user-only preview derivation; rail hidden for 0/1 user messages and for docked; hover/focus preview only on the attended tick; slots are not `flex-1` and use `basis-2 grow-0 shrink`; rail `justify-center`; workspace rail visible → scroll `pl-12`; hidden/docked → `p-3`; smooth jump without unmounting the rail; streaming follow suppression and recovery at bottom; active-tick tracking; session/book remount; bilingual accessible names.

**Related**: `src/components/chat/ChatPanel.tsx`; `src/components/chat/ChatOutlineRail.tsx`; `src/components/chat/hover-intent.ts`; the stick-to-bottom convention above.

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

**Shell**: `SettingsDialog` `DialogContent` is a fixed box (`w-[768px] h-[40rem] max-h-[85vh] sm:max-w-[calc(100%-2rem)]`). Do not widen it for the typography preview. Do not size with max-only classes such as `sm:max-w-3xl` and no explicit height — the box must not jump when switching sections.

Appearance / AI / About keep a single scrolling column (`max-w-md`). Typography splits the right pane into two independently scrolling columns: compact inspector left (`w-64`), live preview right (`flex-1`). Do not put the preview in the inspector scrollport. Below ~520px inner width (`@container` + `@max-[519px]:flex-col-reverse`) stack preview above controls and cap preview height. Do not use `react-resizable-panels` here.

> **Warning**: shadcn `DialogContent` defaults to `w-full max-w-[calc(100%-2rem)] sm:max-w-lg`. A later `max-w-[calc(100%-2rem)]` does **not** override `sm:max-w-lg`; use `sm:max-w-[calc(100%-2rem)]`. Tests that only `toContain("max-w-[calc(100%-2rem)]")` match the default class and miss a missing `sm:` override.

### Convention: settings exclusive choices are a segmented control

**What**: Theme, language, text-align, column count, and the typography override on/off rows in `SettingsDialog` share a local `SegmentedControl` (`src/components/settings/SettingsDialog.tsx`). Appearance rows stay label above, control full width (`PresetRow`). Typography override, alignment, and column count sit inline (`PresetRow inline`, `fullWidth={false}`) so the inspector stays ~260px. The track is `bg-muted`; the selected segment is `bg-background shadow-xs`. The group is `role="radiogroup"`; each option is `role="radio"` with `aria-checked`. Arrow keys move focus; Space / Enter select.

**Why**: Separate bordered `ChoiceButton`s read as three action buttons, not one exclusive choice. A filled `bg-primary` selected state looks like a CTA. `src/components/ui/` is shadcn-owned — do not drop this control there, and do not add `Switch` / `toggle-group` for exclusive on/off rows.

**Don't**:
- Rebuild these rows as independent `rounded border` buttons with `gap-1`.
- Use `bg-primary text-primary-foreground` for the selected segment.
- Change the left nav (排版 / 外观 / AI / 关于) into a segmented control — that is a category list.
- Put `locale` on `preferences.json` when touching the language row (see `i18n.md`).

**Tests**: Query these options as `radio`, not `button`. Assert the group name and the current value's `aria-checked`.

### Convention: typography continuous fields are steppers

**What**: Settings → Typography continuous fields (`fontSize`, `lineHeight`, `contentWidth`, `pagePadding`, `letterSpacing`, `paragraphSpacing`, `firstLineIndent`) use a local `StepperRow`: `Button` `−` / shadcn `Input` / `Button` `+`, plus a unit suffix. Step, clamp, and snap go through `clampSnap` + `TYPOGRAPHY_RANGES`. The input is `type="text"` `inputMode="decimal"` (not `type="number"`). Commit on Enter or blur; Escape restores the last committed value; empty/NaN reverts; out-of-range clamps. `−` disables at min, `+` at max. Aria-labels are `settings.stepper.decrease` / `increase` with `{label}`.

**Why**: Full-width sliders forced a ~448px column, so the live preview scrolled away. Compact steppers keep the 768px shell and leave room for a always-visible preview. Typed values are also more precise than a short slider.

**Don't**:
- Put a `Slider` back on the Typography section. Appearance 界面字号 stays a `Slider`.
- Put the unit inside the input (suffix text beside it).
- Widen the dialog to keep sliders + preview.

> **Warning**: Radix Dialog listens for Escape on `document` in the capture phase. A focused stepper's `onKeyDown` cannot stop the dialog from closing. Handle Escape with `DialogContent` `onEscapeKeyDown`: if `event.target.closest("[data-typography-stepper]")`, `preventDefault()` so the row can revert the draft instead.

**Tests**: Typography has no `slider` named 字体大小 / 首行缩进. `+` from 16px font size calls `onTypographyChange("fontSize", 17)`. Invalid blur reverts. Appearance still exposes `slider` 界面字号. Scrolling the inspector must not unmount `.litera-typography-preview`.

### Convention: book details dialog does not auto-select the title

**What**: `BookDetailsDialog` saves title, author, description, publisher, language, series, and optional cover via `update_book_metadata`. Opening the dialog must `onOpenAutoFocus={(event) => event.preventDefault()}` on `DialogContent`. Do not `autoFocus` or `select()` the title input. Description uses shadcn `Textarea`; the other extra fields use `Input`. `DialogContent` is `max-h-[85vh] overflow-y-auto` so Save stays reachable on the default window. Cards, list rows, continue-reading, and search stay title/author/cover only.

**Why**: Radix Dialog focuses the first tabbable control (the title `Input`). WebView then selects all text, so opening Details looks like "overwrite the title now". Bibliographic extras live on the shelf record, not in the EPUB (see backend `tauri-commands.md` "Scenario: update book metadata after import"). The four extra fields plus cover preview overflow a 800×600 window without a scrollable content box.

**Example**:
```tsx
<DialogContent
  className="max-h-[85vh] overflow-y-auto sm:max-w-md"
  onOpenAutoFocus={(event) => event.preventDefault()}
>
```

**Related**: backend `tauri-commands.md` "Scenario: update book metadata after import"; frontend `i18n.md` `library.field*` keys.

### Convention: library confirms and selection mode

**What**: Library delete and same-path overwrite use `AlertDialog`. Import/delete failures use an in-page banner. Toolbar「选择」enters selection mode; cover clicks toggle checkboxes and must not open a book. Continue-reading is a card row at the top of the shelf (see “continue-reading cards match the shelf grid”), not a toolbar banner and not `list_books` order.

**Why**: `confirm()` / `alert()` block the WebView and do not match the dialog system. Opening a book while an overwrite dialog is open unmounts `LibraryView` and leaves staged imports behind.

**Rules**:
- Disable cover open and duplicate-banner「打开」while `importing`.
- Settle pending overwrite confirms as cancel if `LibraryView` unmounts.
- Gate import (picker + drag-drop) with a synchronous `importingRef`, not only `useState`.
- Process drag-drop files one path at a time (`import_paths([path])` then confirm/commit) so a later file can see a just-committed `contentHash`.

### Convention: continue-reading cards match the shelf grid

**What**: `LibraryView` continue-reading (`takeRecent`, max 4, `lastOpenedAt`) uses the same `BookCard` and the same grid as the shelf: `grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6`. List view still renders continue-reading as that card grid; only the main list becomes `BookListRow`.

**Why**: `grid-cols-4` made each cover fill a quarter of the window. Same `BookCard` (`aspect-[2/3] w-full`) then looked oversized next to `minmax(140px)` shelf cards.

**Rules**:
- Do not use `grid-cols-4` (or any other column count) to force four books across a row.
- Do not add a larger continue-reading card variant or change `BookCard` aspect.
- Search still hides the section; `showDelete={false}` / `showMenu={false}` stay; right-click still uses `BookActionContext`.
- Tests must assert the continue-reading `.grid` className equals the shelf grid className (grid view) and does not contain `grid-cols-4`.

**Example**:
```tsx
// Good — both grids
<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6">

// Bad — fills the row
<div className="grid grid-cols-4 gap-4">
```

**Related**: `src/lib/library-shelf.ts` `takeRecent` / `RECENT_LIMIT`; backend `tauri-commands.md` `list_books` order (continue-reading is a separate slice).

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

### Gotcha: highlight click must beat page-turn on the same pointerup

> **Warning**: Overlay SVG is `pointer-events: none`. Foliate emits `show-annotation` from the iframe **click**, which is after `pointerup`. Left/right thirds already turn the page on that `pointerup`. Waiting for `show-annotation` to suppress paging is too late — the spread turns, then the editor opens on the wrong page.
>
> On iframe `pointerup`, `hitTest` the overlayer at `{ clientX, clientY }`. If the key starts with `epubcfi(`, ignore paging and let the later `show-annotation` open `HighlightEditor`. TTS overlay keys are not CFIs; do not treat them as user highlights.
>
> Do not cover the iframe with highlight hit-boxes. Do not remount `ReaderView` for the editor. Esc / blank click / new selection closes it, same as `SelectionToolbar`.

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

### Convention: footnote popups use fixed positioning + a dedicated inner view

**What**: Clicking a footnote reference (`role="doc-noteref"` / `epub:type="noteref"`, or superscript heuristic) opens a popup near the reference showing the footnote content without leaving the page. The popup is `fixed` positioned (backdrop `z-40` + popup `z-50`, same family as `SelectionToolbar`); content is rendered by a second `<foliate-view>` created by `FootnoteHandler` (`src/foliate-js/footnotes.js`), not extracted as text.

**Why**: Radix `Popover` anchors to iframe-external DOM nodes, so it cannot anchor to a footnote reference inside the chapter iframe. A dedicated inner view preserves book CSS and link interactivity; `FootnoteHandler` already implements fragment extraction (`before-render` / `render` CustomEvents).

**How** (`src/components/ReaderView.tsx`, `src/components/FootnotePopup.tsx`):
- Listen for `link` on the main `<foliate-view>`; call `footnoteHandler.handle(view.book, e)`. A returned promise means a footnote hit (the handler called `e.preventDefault()`, so the main view will NOT `goTo`); `undefined` means a normal link keeps its default behavior.
- Anchor at click time from the clicked `a` element: `getBoundingClientRect()` is chapter-strip local, so add `doc.defaultView.frameElement.getBoundingClientRect()` offset (same pattern as `selectionOverlayPos`). Test `nodeType === 1` instead of `instanceof Element` — the anchor lives in another realm (iframe). The stored point is the reference **center x** and **bottom y**.
- Layout the box with `placeFootnotePopup`: center horizontally on that x; prefer below (`y + gap`); if it does not fit below and there is more space above, flip above; then clamp with `VIEWPORT_MARGIN`. Do not set `left = x` (that left-aligns a 26rem card on the mark and, near the bottom, clamp-only jumps the card to the top of the viewport).
- `before-render`: append the inner view **synchronously** into the always-mounted popup mount point (foliate's `goTo(index)` runs in a microtask and the paginator measures its container during layout); set `flow="scrolled"`, `margin="0"`, `background: transparent`, and `setStyles(stylesCss + footnotePopupCss())`. Inner views do not inherit main-view styles. `footnotePopupCss()` (in `src/lib/reader-styles.ts`) must be appended **after** `generateStylesCss` so `!important` overlay rules beat page padding, `max-width`, first-line indent, and the theme page background. Do not change `generateStylesCss` itself.
- Height after inner `relocate`: read `renderer.viewSize` (paginator expanded content size). If `viewSize` is missing or `<= 0`, fall back to `getContents?.()?.[0]?.doc?.body` height. Round and skip `setState` when unchanged (paginator `ResizeObserver` → `expand()` would otherwise loop). Do **not** size from `body.getBoundingClientRect()` alone — book `min-height: 100%` plus the 160px placeholder freezes a short note at placeholder height.
- This submodule has no paginator `no-background` attribute. Transparent html/body in `footnotePopupCss()` plus `inner.style.background = "transparent"` is the supported way to avoid a book-page fill inside `bg-popover`.
- Inner `link` / `external-link`: close the popup, then delegate to the main view (`goTo(href)` / `window.open(href_)`). The `external-link` detail carries the raw `href_` attribute.
- Esc must also close the popup when focus is inside the chapter iframe or the footnote iframe — bind the check in the existing per-doc `keydown` handler, not only on `window`.
- Close (`closeFootnote`) calls `innerView.close?.()` + `remove()`; run it on popup dismiss, `fileData` change, and unmount. Keep the popup wrapper mounted but hidden (`visibility` + `pointer-events`) so `before-render` can append synchronously.

**Gotcha: `before-render` fires after an async `open(book)` — guard against close and out-of-order races**:

> **Warning**: `FootnoteHandler` dispatches `before-render` only after `view.open(book)` resolves. Two races follow: (1) the user dismisses the popup (Esc / backdrop) while the footnote is still loading — a late `before-render` would mount its inner view into the hidden popup and leak it; (2) rapid clicks on two different footnotes — the older click's `open(book)` can resolve *after* the newer one, so its `before-render` would replace the newer view.
>
> **Correct**: guard with a ref flag (`footnoteOpenRef`) and discard late inner views on close; use a monotonically increasing click sequence number captured per click, with a one-shot `before-render` listener — a `seq` mismatch means the view is stale and must be `close()` + `remove()`d. Dispose the one-shot listener if `handle()`'s promise rejects.
>
> See `src/components/ReaderView.tsx` `handleFootnoteBeforeRender` / `footnoteClick`.

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

`generateStylesCss` writes `font-family`, `font-size`, `line-height`, `letter-spacing`, `max-width`, `padding-inline`, and `text-align` on `html, body`, plus `p { margin-block-end; text-indent }` with `!important` so EPUB chapter CSS does not win on those paragraph rules. Each `setStyles` call replaces the full stylesheet (not additive).

Column count is NOT a CSS-injected style: `columnCount` (1–3, default 2) goes through `ReaderViewHandle.setColumnCount` → `renderer.setAttribute("max-column-count", String(n))` on the foliate paginator. The paginator lists `max-column-count` in `observedAttributes`; setting it updates `--_max-column-count`, which flows through `--_max-width` into the container size and triggers the existing `ResizeObserver` re-render — no manual `render()` call needed (unlike `max-inline-size`). Actual column count is always `min(maxColumnCount, ceil(size / maxInlineSize))` and portrait containers fall back to 1, so never compute columns app-side. Persist `columnCount` like other typography keys; do not add it to `generateStylesCss` / `generatePreviewCss`.

Publisher chapter CSS and `@font-face` still win on `font-family` / most typography unless the user turns on `overrideFont` / `overrideLayout` (Settings → Typography, two `SegmentedControl` rows after the preview). Both flags default off; both off must keep this baseline stylesheet bit-for-bit (do not weaken existing `!important`). Do not strip publisher stylesheets.

- `overrideFont`: user `font-family !important` on body text **and** `h1–h6`; `code, kbd, pre, samp { font-family: monospace !important }`. Still use `cssFontFamily`.
- `overrideLayout`: `font-size`, `line-height`, `letter-spacing`, `text-align` with `!important` on `html, body, p, div, li, blockquote` — not headings. `max-width` / `padding-inline` always apply.
- Persist with the other reader typography keys (`preferences.json` + per-book `ReadingSettings`). Book `false` is a real override. Do not use `localStorage`. See backend `tauri-commands.md` "Scenario: override publisher font and layout".

`font-family` must go through `cssFontFamily`: generics (`serif` / `sans-serif` / `monospace`) stay unquoted; named faces are quoted/escaped and followed by `, serif`. Do not interpolate a raw user-facing family name into the stylesheet.

The Settings font control is a searchable combobox (`Popover` + `Command`), not a segmented control. Theme / language / text-align stay on `SegmentedControl` (see "settings exclusive choices" above). Typography: three generics first, then `list_system_fonts`. Appearance chrome: Geist first (`includeGeist`), then the same generics + system list. If the saved name is missing from the list, keep it selected and mark it unavailable — do not rewrite the stored value. Set `modal={false}` on the popover so it can open inside `SettingsDialog` without a focus trap. One picker component; do not fork a second combobox. Typography writes reader `fontFamily` only. Chrome writes `litera.uiFontFamily` + `applyUiChrome`.

**Caveat**: `view.renderer` is a non-official public field (not documented in foliate.js README). Submodule commit lock mitigates upgrade risk. Fixed-layout epub (foliate-fxl) may not support `setStyles` — MVP targets reflowable only.

**Preview CSS (Settings dialog)**: `generatePreviewCss(state)` (`src/lib/reader-styles.ts`) reuses the same typography properties as `generateStylesCss` but scopes selectors to `.litera-typography-preview` / `.litera-typography-preview p` and omits the `html, body` selectors, the `!important` flags, and the `THEME_CSS` branch. It is injected via a `<style>` tag inside `TypographyPreview` (`src/components/settings/TypographyPreview.tsx`), rendered at the top of the Settings typography section so users see font/spacing changes without closing the dialog. Do not reuse `generateStylesCss` for the preview — its `html, body` selector and dark-theme `background` would pollute the dialog chrome. Keep `generatePreviewCss` free of `background` / global `color` (asserted in `reader-styles.test.ts`).

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
