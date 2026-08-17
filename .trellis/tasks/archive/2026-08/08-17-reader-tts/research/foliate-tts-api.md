# Research: foliate-js TTS API

- Query: How Litera should drive foliate-js TTS (class methods, granularity, setMark/highlight, when to re-init, ReaderView mount, d.ts)
- Scope: internal
- Date: 2026-08-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/foliate-js/tts.js` | `TTS` class, SSML + marks, `setMark` |
| `src/foliate-js/view.js` | `initTTS`, `tts`, media overlay, `lastLocation` |
| `src/foliate-js/text-walker.js` | Range ↔ string segmenter used by TTS |
| `src/foliate-js/paginator.js` | `getContents`, `scrollToAnchor`, `relocate` |
| `src/foliate-js/overlayer.js` | SVG overlay used by user highlights |
| `src/foliate-js/README.md` | TTS is SSML-only; no speech output |
| `src/foliate-js.d.ts` | Ambient types; **no `initTTS` / `tts` today** |
| `src/components/ReaderView.tsx` | Mounts `<foliate-view>`, `ReaderViewHandle` |
| `.trellis/spec/frontend/directory-structure.md` | `<foliate-view>` must be `createElement`, not JSX |
| `.trellis/spec/frontend/type-safety.md` | `foliate-js.d.ts` is the type contract |

### TTS class (`src/foliate-js/tts.js`)

Constructor (`tts.js:210-218`):

```js
new TTS(doc, textWalker, highlight, granularity)
```

- `doc`: the **chapter iframe document** (`renderer.getContents()[0].doc`), not the host document.
- `textWalker`: imported from `text-walker.js` (view.js already imports it).
- `highlight`: `(range: Range) => void`. Called by `setMark` and by `prev`/`next` when `paused` is true.
- `granularity`: passed to `Intl.Segmenter` (`tts.js:24-26`). Default at `initTTS` is `'word'`.

Public methods — **all return a serialized SSML string or `undefined`** (no Promise):

| Method | Side effects | Return |
|---|---|---|
| `start()` | `#lastMark = null`; seek first block | SSML of first non-empty block, else `next()` |
| `resume()` | keep `#lastMark`; stay on current block | SSML of current block **from last mark onward** |
| `prev(paused?)` | `#lastMark = null`; previous block | SSML of prev block; if `paused` and range exists, `highlight(range)` |
| `next(paused?)` | `#lastMark = null`; next block | SSML of next block; same paused highlight |
| `from(range)` | `#lastMark = null`; find first block whose end is at/after `range` start; pick first mark whose start ≥ `range` start | SSML of that block **from that mark onward** |
| `setMark(mark)` | `#lastMark = mark`; `highlight(clone of mark range)` | `void` |

`undefined` means the iterator is exhausted (start/end of **this document / chapter**, not the book).

`#speak` (`tts.js:223-235`): if `getNode` is omitted, serializes the full SSML document. If `getNode` is provided, it clones the SSML and **deletes every node before the mark element**, so `resume()` / `from()` speak from the last/selected mark inclusive.

Iterator unit is a **block**, not a page (`getBlocks`, `tts.js:123-143`): `article/aside/div/p/h1–h6/li/section/…`. One `start`/`next` SSML is one block (typically a paragraph) containing many `<mark name="0"/>`, `<mark name="1"/>`, …

`ListIterator` (`tts.js:145-203`) is lazy: `next()` pulls the next block, rebuilds `#ranges` Map for **that block only**. `setMark` only works for marks of the **current** block. Calling `next()`/`prev()` while speaking the previous block invalidates `#ranges` (Readest documents this race when they preload by walking next/prev).

### Granularity: word vs sentence

`getSegmenter` (`tts.js:24-44`):

- `'word'`: `Intl.Segmenter(lang, { granularity: 'word' })`; **skips** `!isWordLike` (punctuation, spaces). Marks = words.
- `'sentence'`: same API with `'sentence'`; **no** `isWordLike` filter. Marks = sentences.
- Lang comes from `el.lang` / `xml:lang` walking up from the block (`getLang`, `tts.js:14-17`). Fallback `'en'`.

PRD R5 wants **sentence-level follow highlight**. Call `initTTS('sentence', highlight)`.

Do **not** rely on Web Speech `onboundary` to map words if granularity is `'sentence'`. Each mark is a sentence; host should `setMark(name)` once per spoken sentence.

CJK: `Intl.Segmenter` sentence/word support is locale-dependent. Foliate/Readest pick `'sentence'` when `view.language.isCJK`. Litera should pass `'sentence'` always for R5 (PRD is sentence-level). If a CJK book has no sentence breaks, a mark may be a whole block — still acceptable.

### SSML shape

`fragmentToSSML` (`tts.js:47-97`) emits a document in NS `http://www.w3.org/2001/10/synthesis`:

- root `<speak xml:lang="…">`
- `<mark name="N"/>` from inserted `<foliate-mark data-name>`
- `<break>` from `<br>`
- `<emphasis>` from `<em>`/`<strong>`
- `<lang xml:lang>` from nested lang
- `<phoneme alphabet ph>` from `ssml:ph` / `ssml:alphabet`

Serialized via `XMLSerializer` — includes XML declaration / default NS. **Web Speech in Chromium/WebKit does not honor these tags** (see `web-speech-ssml.md`). Host must parse `<mark>` and speak **plain text**.

### `setMark` / highlight

`setMark` (`tts.js:271-277`):

```js
setMark(mark) {
  const range = this.#ranges.get(mark)
  if (range) {
    this.#lastMark = mark
    this.highlight(range.cloneRange())
  }
}
```

`#ranges` keys are `"0"`, `"1"`, … (stringified increment, `tts.js:41`). Unknown mark is a no-op.

**Default highlight** if `initTTS` is called without a callback (`view.js:588-589`):

```js
range => this.renderer.scrollToAnchor(range, true)
```

`scrollToAnchor(anchor, select)` (`paginator.js:918-919`) with `select === true` uses reason `'selection'`. That:

1. Scrolls the range into view (page flip if off-screen).
2. **Selects** the range in the iframe.
3. Fires `relocate` (reason `selection` / `navigation` / `anchor`).

This will pop Litera's `SelectionToolbar` (`ReaderView.tsx:328-348` listens to iframe `selectionchange`) and fight user highlights. **Always pass a custom highlight.**

Recommended highlight (Readest / Foliate pattern, adapted):

1. `overlayer.remove('litera-tts')` then `overlayer.add('litera-tts', range, Overlayer.highlight, { color })`. Key must **not** be a CFI (user annotations use CFI as key via `addAnnotation`).
2. Only `scrollToAnchor(range, false)` when the range is off-screen. `select=false` avoids SelectionToolbar.
3. Do **not** go through `addAnnotation` / `draw-annotation` — those persist as user highlights.

`Overlayer.add` (`overlayer.js:17-24`) replaces same key. `Overlayer.highlight` (`overlayer.js:126-140`) draws SVG rects with `mix-blend-mode`; user highlights use `#fbbf24` (`ReaderView.tsx:26`). Use a distinct color (e.g. a muted accent) so they can overlap without looking like a saved annotation.

### When `initTTS` must be called again

`view.js:584-590`:

```js
async initTTS(granularity = 'word', highlight) {
  const doc = this.renderer.getContents()[0].doc
  if (this.tts && this.tts.doc === doc) return
  const { TTS } = await import('./tts.js')
  this.tts = new TTS(doc, textWalker, highlight || (…), granularity)
}
```

| Event | Re-init? | Why |
|---|---|---|
| First play after `open`/`init` | **Yes** | `tts` is unset until first `initTTS` |
| Page turn **inside** the same chapter | **No** | Same iframe `doc`; iterator already covers the whole body via `getBlocks` |
| Chapter / section change (`load` with new doc) | **Yes** | `tts.doc !== newDoc`; identity check fails and rebuilds |
| `view.close()` | Next play must init | `close()` sets `this.tts = null` (`view.js:306`) |
| New book (`ReaderView` calls `close` then `open`, `ReaderView.tsx:412`) | **Yes** | previous `tts` nulled |
| Change `granularity` or `highlight` on same doc | **Must null `view.tts` first** | Early-return on `tts.doc === doc` **freezes** the first callback and granularity |
| `create-overlayer` / `create-overlay` | Do **not** re-init | New `Overlayer` instance; **re-apply** current mark highlight only |

`getContents()[0]` (`paginator.js:1092-1098`) is the **only** live content (one section). If the book is closed, `getContents()` is `[]` and `[0].doc` **throws**. Guard before calling `initTTS`.

`load` (`view.js:339-348`, ReaderView `handleLoad` at `ReaderView.tsx:350`) fires when a new iframe document is ready. That is the hook to `initTTS` after auto-advance to the next chapter.

`lastLocation` (`view.js:334`) is `{ …progress, tocItem, pageItem, cfi, range }` on every relocate. `range` is the **visible page range**. Use it for R4 “start from current page”:

```
selection range in iframe  →  tts.from(sel)
else lastLocation.range    →  tts.from(visible)
else                       →  tts.start()
```

`from()` compares against block ranges in the current chapter only.

### Media overlay is a different path

`view.js:269-295`, `startMediaOverlay` (`view.js:591-594`). SMIL pre-recorded audio; highlight/unhighlight add CSS classes. PRD out of scope. Do not call `startMediaOverlay` for Web Speech TTS. `close()` also nulls `mediaOverlay`.

### How Litera mounts `<foliate-view>`

`ReaderView.tsx:227-390` (mount-once effect):

- `document.createElement("foliate-view")` appended to `containerRef`.
- Casts to ad-hoc `FoliateAnnotator` / pager types — **never** through `foliate-js.d.ts` `View`.
- Listens: `relocate`, `create-overlay`, `draw-annotation`, `load`.
- Keys: **ArrowLeft / ArrowRight only** (`ReaderView.tsx:302-314`). Space is unused.
- `shouldIgnorePagingTarget` for keys (`reader-paging.ts:37-53`).
- Unmount: `close?.()` then `el.remove()`.

Open effect (`ReaderView.tsx:393-432`): `close` → `open(file)` → `init({})` → optional `goToFraction` → `onBookReady(toc)`.

`ReaderViewHandle` today (`ReaderView.tsx:117-131`):

```
prev, next, goToFraction, goToTocItem, getSectionFractions,
previewLabelAt, goToCfi, setStyles, getToc, getLocation,
getSelectionCfi, addHighlight, removeHighlight
```

No TTS. `getLocation()` returns `{ cfi, fraction, label }` from `lastLocationRef` — **no `range`** (Range cannot cross the React/handle boundary usefully without staying on the view).

**Recommended handle additions** (keep Range/SSML inside ReaderView; do not leak `any`):

```ts
initTts: (opts?: { granularity?: "word" | "sentence" }) => Promise<boolean>
speakOrigin: () => Promise<string | undefined>  // SSML: selection else visible else start
ttsNext: () => string | undefined
ttsResume: () => string | undefined
ttsSetMark: (mark: string) => void
clearTtsHighlight: () => void
ensureTtsVisible: (opts?: { scrollIfNeeded?: boolean }) => void
```

Alternatively expose a small `ReaderTtsHandle` object created inside ReaderView that owns `initTTS` + overlayer key + `from`/`next`/`setMark`. SpeechSynthesis stays in `src/lib/reader-tts.ts` (not in the handle).

`getSelectionCfi` already walks iframe selections (`readIframeSelection`, `ReaderView.tsx:178-191`). Reuse that walk to get a `Range` for `tts.from` internally.

### What to add to `src/foliate-js.d.ts`

Current `View` (`foliate-js.d.ts:18-36`) has no `tts`, `initTTS`, `renderer`, `book`, `lastLocation`, `close`. Litera currently casts `as unknown as { … }`.

Add **without `any`**:

```ts
export type TtsGranularity = "grapheme" | "word" | "sentence";

export interface TtsHighlight {
  (range: Range): void;
}

export class TTS {
  readonly doc: Document;
  highlight: TtsHighlight;
  constructor(
    doc: Document,
    textWalker: (
      root: Range | Document | DocumentFragment,
      func: (strs: string[], makeRange: (
        startIndex: number, startOffset: number,
        endIndex: number, endOffset: number,
      ) => Range) => Iterable<[string, Range]>,
    ) => Iterable<[string, Range]>,
    highlight: TtsHighlight,
    granularity?: TtsGranularity,
  );
  start(): string | undefined;
  resume(): string | undefined;
  prev(paused?: boolean): string | undefined;
  next(paused?: boolean): string | undefined;
  from(range: Range): string | undefined;
  setMark(mark: string): void;
}

export interface FoliateContents {
  index: number;
  doc?: Document;
  overlayer?: {
    add(key: string, range: Range, draw: unknown, options?: { color?: string }): void;
    remove(key: string): void;
  };
}

export interface FoliateRenderer {
  getContents(): FoliateContents[];
  scrollToAnchor(anchor: Range | number, select?: boolean): Promise<void>;
  setStyles?(css: string): void;
  nextSection?(): Promise<void>;
}

export class View extends HTMLElement {
  // existing methods…
  book?: Book & { toc?: unknown[]; sections?: { id?: string; cfi?: string }[] };
  renderer: FoliateRenderer;
  tts: TTS | null;
  mediaOverlay: EventTarget | null;
  lastLocation: {
    cfi?: string;
    range?: Range;
    tocItem?: { label?: string; href?: string };
    fraction?: number;
  } | null;
  initTTS(granularity?: TtsGranularity, highlight?: TtsHighlight): Promise<void>;
  startMediaOverlay(): unknown;
  close(): void;
}

declare module "*/foliate-js/tts.js" {
  export class TTS { /* same as above */ }
}
```

`initTTS` is on `View`, not a free function. `TTS` methods are sync and return `string | undefined` (serialized SSML). Do not type them as `Promise`.

`ReaderView` can then `import type { View, TTS } from "*/foliate-js/view.js"` (or keep a local `FoliateView = View`) and drop most `as unknown as` pager casts for TTS.

## Recommended host loop (Litera)

1. On play: `await view.initTTS('sentence', drawTtsHighlight)`.
2. `ssml = selection ? tts.from(sel) : lastLocation.range ? tts.from(range) : tts.start()`.
3. Parse SSML marks → speak each mark’s **plain text** via `SpeechSynthesisUtterance`; on each mark start call `tts.setMark(name)`.
4. On utterance `end`: next mark in the same SSML; if none, `ssml = tts.next()`; if `undefined`, `await view.next()` / `renderer.nextSection()`, wait for `load`, `initTTS` again, `tts.start()`, continue. Stop at book end (`next` no-ops / no new doc).
5. Pause: `speechSynthesis.pause()` (see web-speech caveats) **or** cancel and keep `#lastMark`; resume via `tts.resume()`.
6. Stop / leave reader: `cancel()`, `overlayer.remove('litera-tts')`, do not persist TTS state.

## Caveats / Not Found

- Bundled `src/foliate-js/reader.js` has **no** TTS wiring. Host examples are upstream Foliate GTK (`book-viewer.js` `initTTS` / `ttsStart` / `ttsSetMark`) and Readest `TTSController`.
- `initTTS` does not accept a `Range` in this submodule pin. Speak-from-here is `initTTS` then `tts.from(range)`.
- `getContents()[0]` is undocumented as “current section”; paginator only keeps one. Do not assume a spread of multiple docs.
- `tts.js` `#getMarkElement` query is missing a closing `]` (`mark[name="${CSS.escape(mark)}"`). Works in practice with `querySelector` but is a library quirk; do not “fix” the submodule unless asked.
- Media overlay and TTS share no state except `close()` nulling both.
