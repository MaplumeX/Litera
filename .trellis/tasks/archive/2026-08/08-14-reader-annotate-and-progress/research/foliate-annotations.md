# Research: foliate-js annotation / bookmark APIs

- Query: How Litera can persist and render EPUB bookmarks + single-color highlights using foliate-js View APIs
- Scope: mixed (pinned submodule commit inspected on GitHub; Litera ReaderView / styles / types read locally)
- Date: 2026-08-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/foliate-js/` | Submodule gitlink `78914aef4466eb960965702401634c2cb348e9b1`; **not checked out** in this worktree (empty dir). Source below is that exact commit on GitHub: [johnfactotum/foliate-js@78914aef](https://github.com/johnfactotum/foliate-js/tree/78914aef4466eb960965702401634c2cb348e9b1). |
| `src/foliate-js.d.ts` | Litera’s typed surface today: `open` / `init` / `goToFraction` / `prev` / `next` / `goLeft` / `goRight` / `close`. **No** annotation, CFI, or `goTo` typings. |
| `src/components/ReaderView.tsx` | Mounts `<foliate-view>`, listens to `relocate` + `load`, restores via `goToFraction`, injects CSS via `renderer.setStyles`, hosts the selection “问 agent” overlay. |
| `src/lib/reader-styles.ts:276` | `generateStylesCss` → `view.renderer.setStyles`. |
| `src/App.tsx` | Debounced `update_reading_state({ lastFraction })`; does not keep CFI. |
| GitHub `view.js` | View APIs: `addAnnotation`, `deleteAnnotation`, `showAnnotation`, `getCFI`, `goTo`, `init({ lastLocation })`. |
| GitHub `overlayer.js` | SVG overlay; `Overlayer.highlight(rects, { color })`. |
| GitHub `paginator.js` | iframe chapter pages; `setStyles`; emits `create-overlayer`. |
| GitHub `progress.js` | `SectionProgress.getProgress` → book `fraction`; `getSection(fraction)` inverse. |
| GitHub `epubcfi.js` | `fromRange` / `toRange` / `joinIndir` / `isCFI` / `fake.fromIndex`. |
| GitHub `reader.js` | Official demo of restore + draw (Calibre highlights). |

Submodule was **not** initialized. All foliate-js quotes are from raw GitHub at `78914aef`.

### Code Patterns

#### 1. Locators: CFI vs fraction vs href

`View.resolveNavigation(target)` (`view.js:446-458`) accepts four shapes:

| Target | Shape | Use |
|---|---|---|
| Section index | `number` | Coarse; start of a spine item |
| Book fraction | `{ fraction: number }` | Current progress restore; **page-ish, not a text range** |
| EPUB CFI | string matching `epubcfi(...)` | Point **or** range. Highlights must be this. Page bookmark should be this. |
| href | TOC / internal link string | Chapter jump only (`goToTocItem` today) |

Stable locator for a **paginated “current page”** (bookmark):

- On every `relocate`, View stores `lastLocation.cfi = this.getCFI(index, range)` where `range` is the **visible page** `Range` from the paginator (`view.js:329-337`).
- `getCFI(index, range)` (`view.js:431-435`): no range → section base CFI; with range → `CFI.joinIndir(baseCFI, CFI.fromRange(range))`.
- That CFI survives font/theme reflow (same text). Fraction does **not** stay on the same page after `setStyles`.
- `href` / `tocItem.href` is a chapter, not a page.

Stable locator for a **highlight** (text range):

- `view.getCFI(index, selectionRange)` on the iframe `Range`.
- `addAnnotation` / `goTo` / `showAnnotation` all treat `annotation.value` as that CFI string.

Litera today only persists `lastFraction` (`App.tsx:134-136`) and restores with `goToFraction` after `init({})` (`ReaderView.tsx:276-288`). `init({})` with no `lastLocation` always calls `next()` (`view.js:314-325`), which is why restore must run after init.

Recommended store:

- Bookmark: **CFI from `lastLocation.cfi`** (goTo target) + **fraction** (list sort / fallback after EPUB rewrite).
- Highlight: **range CFI** from `getCFI` + excerpt. No color field.

#### 2. Getting a CFI from the current location or selection

**Current page (bookmark)** — already on the relocate event, unused by Litera:

```js
// view.js:329-337
#onRelocate({ reason, range, index, fraction, size }) {
    const progress = this.#sectionProgress?.getProgress(index, fraction, size) ?? {}
    const tocItem = this.#tocProgress?.getProgress(index, range)
    const pageItem = this.#pageProgress?.getProgress(index, range)
    const cfi = this.getCFI(index, range)
    this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }
    this.#emit('relocate', this.lastLocation)
}
```

`relocate` detail fields Litera already reads (`ReaderView.tsx:83-87, 150-158`): `index`, `fraction`, `tocItem.{label,href}`. **Also present, unused:** `cfi`, `range`, `pageItem`, `location`, `section`, `time`. `View.lastLocation` is the same object.

**Selection (highlight)** — must come from the **chapter iframe**, not `window.getSelection()`:

```js
// view.js:431-435, 1092-1098 (paginator getContents)
getCFI(index, range) {
    const baseCFI = this.book.sections[index].cfi ?? CFI.fake.fromIndex(index)
    if (!range) return baseCFI
    return CFI.joinIndir(baseCFI, CFI.fromRange(range))
}
```

Smallest host helper:

```ts
const contents = view.renderer.getContents() as { index: number; doc: Document }[];
for (const { index, doc } of contents) {
  const sel = doc.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) continue;
  const range = sel.getRangeAt(0);
  const cfi = view.getCFI(index, range);
  const excerpt = sel.toString().trim();
}
```

`renderer.getContents()` returns `[{ index, overlayer, doc }]` for the loaded iframe (`paginator.js:1092-1098`).

#### 3. `addAnnotation` / `deleteAnnotation` / draw

Signatures (`view.js:368-400`):

```js
async addAnnotation(annotation, remove) {
    const { value } = annotation          // CFI string (or "foliate-search:" + cfi)
    // resolveNavigation(value) → { index, anchor }
    // if overlayer for that section exists:
    //   overlayer.remove(value)
    //   if (!remove) emit 'draw-annotation' { draw, annotation, doc, range }
    return { index, label }               // TOC label; even if overlayer missing
}
deleteAnnotation(annotation) {
    return this.addAnnotation(annotation, true)
}
```

- Only **`annotation.value`** is consumed by View. Extra keys (`color`, `note`, `id`) pass through to `draw-annotation` unused.
- Key in the overlay map is `value` (the CFI). Duplicate CFI = replace.
- If the section iframe is **not** loaded, `#getOverlayer(index)` is undefined: nothing is drawn, no error. Restore **must** wait for `create-overlay`.
- Search hits use prefix `foliate-search:` and draw themselves. Host annotations must **not** use that prefix.

Host **must** paint on `draw-annotation`. View does not pick a default style. Demo (`reader.js:178-181`):

```js
this.view.addEventListener('draw-annotation', e => {
    const { draw, annotation } = e.detail
    const { color } = annotation
    draw(Overlayer.highlight, { color })
})
```

`Overlayer.highlight` (`overlayer.js`, static):

```js
static highlight(rects, options = {}) {
    const { color = 'red' } = options
    // SVG rects, opacity var(--overlayer-highlight-opacity, .3)
}
```

Litera MVP: always `draw(Overlayer.highlight, { color: /* one fixed color */ })`. Do not persist color.

`Overlayer` lives in `overlayer.js`. Litera would import `{ Overlayer } from "../foliate-js/overlayer.js"` (or a relative path once the submodule is checked out). The overlay SVG is **outside** the iframe (`pointer-events: none`); `setStyles` CSS does not restyle highlights. Paginator calls `overlayer.redraw()` on expand.

#### 4. Restoring after `open` / `init` / `load`

Order that actually paints:

1. `await view.open(file)` — builds paginator, **does not** navigate.
2. `await view.init({ lastLocation })` **or** Litera’s current `init({})` + `goToFraction`.
3. Section iframe `load` → paginator emits `create-overlayer` → View `#createOverlayer` emits **`create-overlay` `{ index }`** (`view.js:406-418`).
4. Host, on `create-overlay`, calls `addAnnotation({ value: cfi })` for every highlight whose CFI resolves to that `index`.
5. Each `addAnnotation` emits `draw-annotation`; host calls `draw(Overlayer.highlight, { color })`.

Demo (`reader.js:172-176`):

```js
this.view.addEventListener('create-overlay', e => {
    const { index } = e.detail
    const list = this.annotations.get(index)
    if (list) for (const annotation of list)
        this.view.addAnnotation(annotation)
})
```

Do **not** only restore once after `open`/`init`. Overlayer is recreated every time that section iframe is (re)loaded. Calling `addAnnotation` before `create-overlay` is a no-op paint.

Bookmarks are **not** drawn. They are list + `goTo` only.

`init({ lastLocation })` (`view.js:314-325`):

```js
async init({ lastLocation, showTextStart }) {
    const resolved = lastLocation ? this.resolveNavigation(lastLocation) : null
    if (resolved) {
        await this.renderer.goTo(resolved)
        this.history.pushState(lastLocation)
    } else if (showTextStart) await this.goToTextStart()
    else {
        this.history.pushState(0)
        await this.next()
    }
}
```

`lastLocation` here is any `resolveNavigation` target: CFI string or `{ fraction }`. Litera can keep `init({})` + `goToFraction` for progress; bookmark/highlight jumps use `goTo` later.

#### 5. `goTo` targets: highlight vs bookmark

```js
// view.js:460-475
async goTo(target) {                    // CFI | href | index | { fraction }
    const resolved = this.resolveNavigation(target)
    await this.renderer.goTo(resolved)
    this.history.pushState(target)
    return resolved
}
async goToFraction(frac) {
    const [index, anchor] = this.#sectionProgress.getSection(frac)
    await this.renderer.goTo({ index, anchor })
    this.history.pushState({ fraction: frac })
}
```

| Kind | Jump API | Target |
|---|---|---|
| Bookmark (page) | `view.goTo(bookmark.cfi)` | `lastLocation.cfi` (page-range CFI). Fallback: `goToFraction(bookmark.fraction)` if CFI fails after overwrite. |
| Highlight | `view.goTo(highlight.cfi)` or `view.showAnnotation({ value: cfi })` | Range CFI. `showAnnotation` also emits `show-annotation` after landing (`view.js:421-428`). |
| Progress scrubber | `view.goToFraction(frac)` | Already on `ReaderViewHandle`. |
| TOC | `view.goTo(href)` | Already `goToTocItem`. |

`showAnnotation` is optional chrome (scroll + “this is the highlight”). List click can be `goTo(cfi)` only.

#### 6. Event names (exact)

| Event | Emitted by | `detail` | Host duty |
|---|---|---|---|
| `relocate` | View (`view.js:337`) | `{ fraction, section, location, time, tocItem, pageItem, cfi, range }` plus paginator’s `reason`/`index` folded into progress | Persist progress; snapshot `cfi`/`fraction`/`tocItem` for a new bookmark |
| `load` | View (`view.js:347`) | `{ doc, index }` | Bind iframe `selectionchange` / paging (Litera already binds paging here: `ReaderView.tsx:225-248`) |
| `create-overlayer` | **paginator** (`paginator.js:989`) | `{ doc, index, attach }` | Internal. View attaches Overlayer. Host should **not** listen. |
| `create-overlay` | View (`view.js:418`) | `{ index }` | Re-`addAnnotation` highlights for that section |
| `draw-annotation` | View (`view.js:393`) | `{ draw, annotation, doc, range }` | `draw(Overlayer.highlight, { color })` |
| `show-annotation` | View (`view.js:411`, `428`) | `{ value, index, range }` | Optional: click on painted highlight (delete / list focus). Overlay SVG is `pointer-events: none`; hit-test is on the iframe `click`. |

Litera currently listens only to `relocate` and `load` (`ReaderView.tsx:160, 248`).

#### 7. Litera constraints

- **CSS via `renderer.setStyles`**: `ReaderView.tsx:354-356`, `paginator.js:1100`. String CSS injected into the iframe. Highlights are a sibling SVG; they are not restyled by this CSS. After `setStyles`, paginator reflows and `Overlayer.redraw()` reruns from live Ranges — CFIs stay valid.
- **Paging is iframe-based**: `paginator.js:213-251`, sandbox `allow-same-origin allow-scripts`. Selection lives on `doc.getSelection()`, not `window.getSelection()`.
- **Selection overlay is host chrome** (`ReaderView.tsx:297-336, 373-388`): parent `document.selectionchange` + `window.getSelection()` + `view.contains(range)`. That is the wrong document for an iframe chapter. Highlight (and a reliable “问 agent”) must hook `load`’s `doc` (`selectionchange` on `doc`, `doc.getSelection()`), same as paging already does. Keep “问 agent”; add a highlight action next to it. Do not put highlight UI inside the iframe.
- **`foliate-js.d.ts`** must grow if ReaderView calls these methods; today they are untyped `unknown` casts.

### Smallest API surface Litera should use

Do **not** use search (`foliate-search:`), TTS, `select()`, Calibre importers, or `Overlayer.underline/squiggly`.

| Need | Call |
|---|---|
| Page locator for bookmark | `e.detail.cfi` + `e.detail.fraction` + optional `e.detail.tocItem?.label` from `relocate` |
| Range locator for highlight | `view.getCFI(index, iframeRange)` |
| Paint / persist-restore highlight | listen `create-overlay` → `view.addAnnotation({ value: cfi })`; listen `draw-annotation` → `draw(Overlayer.highlight, { color: FIXED })` |
| Remove paint | `view.deleteAnnotation({ value: cfi })` |
| Jump bookmark or highlight | `view.goTo(cfi)` |
| Jump progress | existing `view.goToFraction(frac)` |
| Optional click-on-highlight | listen `show-annotation` `{ value }` |

`ReaderViewHandle` additions that match this (and nothing more): get current `{ cfi, fraction, label }`, get selection `{ cfi, excerpt }`, `addHighlight(cfi)`, `removeHighlight(cfi)`, `goToCfi(cfi)`. Persistence stays in App / Tauri, not in foliate-js.

### External References

- [foliate-js README @ 78914aef](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/README.md) — renderer events `load` / `relocate` / `create-overlayer`; overlayer interface; CFI module. Library is explicitly unstable; pin the submodule.
- [view.js @ 78914aef](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/view.js)
- [reader.js demo](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/reader.js) — only in-tree host of `create-overlay` / `draw-annotation` / `addAnnotation`.

### Related Specs

- `.trellis/tasks/08-14-reader-annotate-and-progress/prd.md` — bookmark = current page; highlight = selection; no notes / no colors.
- `.trellis/spec/frontend/` — no existing annotation guideline; ReaderView is the integration point.

## Caveats / Not Found

- `src/foliate-js` is an empty gitlink. Line numbers are from GitHub `78914aef`, not a local tree. Implementer should `git submodule update --init src/foliate-js` before coding.
- foliate-js has **no persist layer**. View is render-only. Litera owns JSON + Tauri commands (see `annotation-persistence.md`).
- `addAnnotation` does not accept a DOM Range. Host must convert to CFI first.
- Range CFIs are intra-section. A selection that crossed spine items would need two CFIs; paginator only has one iframe, so MVP can ignore that.
- After overwrite with a **different** EPUB, stored CFIs may fail `resolveNavigation` (it `console.error`s and returns undefined). Bookmark fallback = `fraction`. Highlight with a dead CFI cannot be painted.
- Official desktop Foliate (GTK app) was not required; demo `reader.js` is the documented host pattern.
- Whether `window.getSelection()` currently works for “问 agent” on this Tauri/WebView is unverified. Treat iframe `doc.getSelection()` as the correct API for both ask-agent and highlight.
