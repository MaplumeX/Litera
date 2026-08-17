# Research: Reader TTS integration points

- Query: Existing chrome, localStorage prefs, i18n, tests, files likely to change, collisions
- Scope: internal
- Date: 2026-08-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/App.tsx` | Reader header, progress bar, mode/collapse, relocate persist |
| `src/components/ReaderView.tsx` | Keys, highlights, `ReaderViewHandle` |
| `src/components/ReaderProgressBar.tsx` | Bottom bar; TTS bar sits **above** this |
| `src/components/SelectionToolbar.tsx` | Highlight + 问 agent only |
| `src/lib/reader-paging.ts` | `shouldIgnorePagingTarget` |
| `src/lib/reader-mode.ts` | localStorage pref pattern |
| `src/lib/ui-chrome-font.ts` | Same pref pattern |
| `src/lib/i18n.ts` | `t` / `useT` / `litera.locale` |
| `src/locales/zh-CN.ts` / `en.ts` | Catalogs; no TTS keys |
| `.trellis/spec/frontend/i18n.md` | Do **not** add keys to `preferences.json` |
| `src/App.reader-mode.test.tsx` | Mocks `ReaderViewHandle` |
| `src/App.annotations.test.tsx` | Same mock shape |
| `src/components/SelectionToolbar.test.tsx` | Two buttons only |
| `src/lib/i18n.test.ts` | Catalog key parity |

### Existing chrome

**Header** (`App.tsx:868-936`), left → right:

1. Back (`reader.backToLibrary`) → `handleBackToLibrary` (`App.tsx:464-485`): flush progress, `setFileData(null)` (unmounts `ReaderView`), `setView("library")`.
2. TOC + Annotations — **only when `readerMode === "reader"`** (`App.tsx:877`).
3. Book title + drag region.
4. Font/theme (`reader.fontAndTheme`) → `SettingsDialog`.
5. Divider.
6. TOC + Annotations — **only when `readerMode === "agent"`** (same buttons, different slot).
7. Mode toggle (`reader.switchToAgent` / `switchToReader`).
8. Reader mode: chat collapse. Agent mode: **book collapse** (`reader.hideBook` / `showBook`).
9. `WindowControls`.

PRD R3: play/pause **icon in this header**. Put it in the cluster at `App.tsx:890-899` (next to Type) or just before the mode toggle. Only render when `view === "reader"` and `fileData` is set (R1: not on library).

**Progress bar** (`App.tsx:1026-1036`, component `ReaderProgressBar.tsx:59-162`): `h-9 shrink-0 border-t`, chapter label, seek track, prev/next chapter. Lives as a **sibling under the book cell**, below the `flex-1` ReaderView wrapper (`App.tsx:960-1036`).

PRD R3a: playback bar **above the progress bar**, below the page, visible only while speaking (or paused-in-session). Insert a new component between the reader wrapper (`App.tsx:960-1025`) and `<ReaderProgressBar>`. Do **not** put rate/voice in Settings or a header popover.

Suggested `ReaderTtsBar` props: `playing`, `onPause`, `onStop`, `rate`, `onRate`, `voices`, `voiceURI`, `onVoice`. Hide when `status === 'idle'`. Stop or leave reader → unmount/hide.

**SelectionToolbar** (`SelectionToolbar.tsx:11-41`): 高亮 + 问 agent. PRD out of scope: no “朗读” button. Selection is only a **start offset** (R4). Do not change this component.

**Keyboard in ReaderView** (`ReaderView.tsx:302-314`):

```
no modifier
shouldIgnorePagingTarget(target) → return
ArrowLeft  → pageLeft (goLeft ?? prev)
ArrowRight → pageRight (goRight ?? next)
```

App (`App.tsx:319-339`) only handles **Escape** to close TOC/annotations. Comment: “Page turning lives in ReaderView … do not handle ArrowLeft/ArrowRight here.”

Space is **free**. PRD R3: Space = play/pause. Best place: **same `handleKeyDown` in ReaderView** so iframe `doc.keydown` (`ReaderView.tsx:364`) and `window.keydown` (`:325`) both see it. Alternatively App-level, but then iframe focus (chapter document) never hits App unless you also bind in `handleLoad`.

**`shouldIgnorePagingTarget`** (`reader-paging.ts:37-53`):

- `INPUT` / `TEXTAREA` / `SELECT`
- `contentEditable`
- `[role="dialog"]` (Settings)
- Cross-realm: no `instanceof`; uses `tagName` / `closest`

Does **not** ignore:

- `BUTTON` / `[role=button]` — Space on a focused play button would fire **click and** the window handler → double toggle.
- `[role=slider]` / `input[type=range]` — rate slider.
- Progress-bar track (custom div, not a slider).

Recommendation: for Space only, also ignore `BUTTON`, `[role=button]`, `[role=slider]`, `input[type=range]`. Keep arrows unchanged. Either add `shouldIgnoreSpaceTarget` next to `shouldIgnorePagingTarget` or pass a flag. Tests: `src/lib/reader-paging.test.ts:98-121`.

Chat input is a `textarea` — already ignored. Agent book-collapsed still has chat focus; Space should type a space, not play.

### localStorage preference pattern

Do **not** add TTS fields to `preferences.json` / `PreferencesDataRaw` (`deny_unknown_fields`; older builds would reset theme). Spec: `.trellis/spec/frontend/i18n.md:20-24`.

Copy `src/lib/reader-mode.ts`:

```
KEY + DEFAULT
isX / parseX
loadX(): try localStorage, catch → default
saveX(): try setItem, catch ignore (private mode / quota)
```

Same in `ui-chrome-font.ts` (`litera.uiFontSize`, `litera.uiFontFamily`).

Suggested keys:

| Key | Value | Default |
|---|---|---|
| `litera.ttsRate` | number string, clamp e.g. 0.5–3 | `"1"` |
| `litera.ttsVoice` | `SpeechSynthesisVoice.voiceURI` | `""` (system default) |

Do **not** persist playing/paused. Rate/voice are app-wide, not per-book (PRD R9: “与 locale / 界面字体同类”).

Module store is optional. Rate/voice can be React state in App initialized from `loadTtsRate()`; save on change. No Redux/Zustand/Context (frontend spec).

### i18n catalog pattern

- Keys live in **both** `src/locales/zh-CN.ts` and `src/locales/en.ts`.
- `MessageKey` is inferred from `zhCN` (`i18n.ts:3`). `en` is `{ [K in MessageKey]: string }`.
- `src/lib/i18n.test.ts:85` asserts `Object.keys(zhCN) === Object.keys(en)`.
- Vitest setup pins `zh-CN` (`i18n.md:75`). Existing tests query Chinese strings.
- `useT()` **before** any early return.
- Interpolation: `{name}` only (`i18n.ts:99-102`).

Existing `reader.*` keys (`zh-CN.ts:13-36`): persist/open, back, toc, font, chat/book show/hide, mode switch, resize, annotations, highlight, askAgent, prev/next chapter, progress.

Add new keys (suggested):

```
reader.ttsPlay          朗读 / Read aloud
reader.ttsPause         暂停 / Pause
reader.ttsStop          停止 / Stop
reader.ttsRate          语速 / Speed
reader.ttsVoice         声音 / Voice
reader.ttsNoVoices      系统没有可用的语音 / No system voices available
reader.ttsError         朗读失败：{message} / Read aloud failed: {message}
```

Aria-labels on header icon and bar buttons. Header icon is `size="icon-sm"` `variant="ghost"` like Type (`App.tsx:891-898`). Use lucide `Volume2` / `Pause` (already importing lucide in App).

Do **not** add keys to Settings appearance. Language names stay native (`i18n.md:65`).

### Test patterns

**`App.reader-mode.test.tsx`**

- jsdom + mocked `invoke`, window, import, LibraryView.
- **`readerHandle: ReaderViewHandle` object** (`:59-80`) passed through `useImperativeHandle`. **Any new handle method must be added here and in `App.annotations.test.tsx:61-82`** or TypeScript fails.
- Queries chrome by **Chinese aria-label** (`getByLabelText("切换到 Agent 模式")`).
- `keeps ReaderView and ChatPanel mounted` (`:304-318`): mode switch does not remount.
- `collapses … book` (`:335-348`): `hidden` book, `gridTemplateColumns: 1fr 0px`, **ReaderView still in the tree**.
- `does not fill chat when the agent-mode book is collapsed` (`:359+`).

Add cases:

- Library view: no `reader.ttsPlay` button.
- Open book: play button present.
- After play, `data-testid="reader-tts-bar"` appears above progress bar.
- Stop / back-to-library: bar gone (mock player `stop`).

Because `ReaderView` is mocked, speech + `initTTS` belong in **unit tests** of `reader-tts.ts` / a thin `ReaderView` test, not App.

**`SelectionToolbar.test.tsx`**

- Asserts exactly `["高亮", "问 agent"]`. Leave it. No third button.

**`ReaderProgressBar.test.tsx`**

- Isolated. TTS bar is a sibling; do not stuff TTS into this component.

**i18n**

- After adding keys, parity test stays green if both catalogs updated.
- One component test should `setLocale("en")` and assert an English aria-label (`i18n.md:77`).

### Relocate / progress persistence

`handleRelocate` (`App.tsx:487-497`): every `relocate` writes `progress` state and `persistFraction.schedule(bookId, fraction)` (debounce 500ms, `App.tsx:218-224`).

TTS `scrollToAnchor` **will** fire relocate and persist. R11: do not change persist semantics unless required. Auto-page-follow updating `lastFraction` is acceptable (user “read” via ears). Risk is **storms**: word-level `setMark` + scroll on every word. Sentence granularity + scroll-only-if-offscreen keeps this to ~once per page.

`seekProgress` (`App.tsx:772-776`) uses `createLatestSerializedTaskController` — TOC/seek already serialized. TTS auto-`next()` should go through `readerRef.next()` / `goToFraction` the same way, or it races a user drag.

Open PRD question: **manual page / seek / TOC while speaking — stop or resync?** Not decided. Implementation should isolate a single function `onUserNavigateWhileSpeaking()` so the decision is one line. Safer default until UX is closed: **stop** (cancel + clear highlight). Resync (`initTTS` + `from(new visible range)`) is more code and fights relocate storms.

### Book collapsed in agent mode

`bookHidden = readerMode === "agent" && bookCollapsed` (`App.tsx:771`). Cell uses HTML `hidden` (`App.tsx:950`). **ReaderView stays mounted** (test `:346`). Audio would continue with no visible page.

R10 lists 返回书库 / 换书 / 卸载阅读页. Collapsing the book is none of those, but speaking into a `hidden` iframe is a collision. Recommendation: **stop TTS when `bookHidden` becomes true** (and on `handleBackToLibrary`, `fileData` change, ReaderView unmount).

Mode switch reader ↔ agent **keeps** ReaderView mounted (`:304-318`). Do not stop on mode switch unless the book is then hidden.

### Highlight overlay collision

User highlights:

- Key = CFI (`paintHighlight` → `addAnnotation`, `ReaderView.tsx:169-176`).
- Drawn in `draw-annotation` with `Overlayer.highlight` + `#fbbf24` (`:258-261`).
- Re-painted on `create-overlay` (`:252-257`) and when `highlights` prop changes (`:434-445`).

TTS highlight must:

- Use a **reserved key** (`litera-tts`), never a CFI.
- `overlayer.add/remove` directly; never `addAnnotation`.
- Re-apply on `create-overlay` / after page turn (new Overlayer).
- `clearTtsHighlight` on stop / unmount / book change.

`Overlayer.hitTest` (`overlayer.js:41-50`) walks newest-first. A TTS rect on top of a user highlight can steal the click (`view.js:404-412` `show-annotation`). Mitigate: draw TTS **under** by adding it first, or ignore `litera-tts` in a host click handler. Simpler: use a lower-opacity color and accept hit-test; clicking a spoken sentence opening a user annotation popover is rare if we do not call `show-annotation` for that key (`view.js:410` already skips `SEARCH_PREFIX`; TTS key is not a CFI so `show-annotation` payload is harmless if we do not listen).

`SelectionToolbar` during TTS: default `scrollToAnchor(..., true)` **selects** text and opens the toolbar. Custom highlight must not select.

### Files likely to change

| File | Why |
|---|---|
| `src/foliate-js.d.ts` | Type `initTTS` / `TTS` / `renderer.getContents` |
| `src/components/ReaderView.tsx` | Handle methods, custom highlight, Space, clear on unmount |
| `src/App.tsx` | Header play button, TtsBar slot, stop on back/collapse/book change |
| `src/components/ReaderTtsBar.tsx` | **New** — pause/stop/rate/voice |
| `src/lib/reader-tts.ts` | **New** — prefs, parse SSML, player |
| `src/lib/reader-paging.ts` | Space-target ignore |
| `src/locales/zh-CN.ts` | New keys |
| `src/locales/en.ts` | Same keys |
| `src/App.reader-mode.test.tsx` | Mock handle + chrome tests |
| `src/App.annotations.test.tsx` | Mock handle sync |
| `src/lib/reader-paging.test.ts` | Space ignore |
| `src/lib/reader-tts.test.ts` | **New** — parse marks, prefs clamp, onerror filter |
| `src/components/ReaderTtsBar.test.tsx` | **New** |

Probably untouched: `SelectionToolbar.tsx`, `ReaderProgressBar.tsx` (sibling only), `preferences.rs`, Settings, agent runtime.

`src/foliate-js/*` is a **git submodule** (directory-structure.md). Do not edit `tts.js` / `view.js` unless the task explicitly allows a submodule bump.

### Risky collisions (checklist)

1. **User highlight vs TTS highlight** — separate Overlayer key; never `addAnnotation`.
2. **Relocate storms while speaking** — sentence marks; scroll only if off-screen; `select=false`.
3. **`persistFraction` on auto-page** — allowed; debounce 500ms already.
4. **`initTTS` same-doc early return** — null `view.tts` before changing highlight/granularity.
5. **`create-overlay` drops TTS rect** — re-`setMark` / re-add overlay.
6. **`tts.next()` during speak invalidates `#ranges`** — do not prefetch by walking next/prev without restoring (Readest race).
7. **Book collapsed, ReaderView still mounted** — stop audio.
8. **`fileData` change / back to library** — unmount path calls `close()`; also `cancel()` in App so a queued utterance cannot `setMark` on a dead view.
9. **Space vs chat / settings / focused button / rate slider** — extend ignore list.
10. **`cancel()` → `onerror canceled`** — must not auto-advance.
11. **Chrome 15s cutoff** — one utterance per sentence mark, not whole chapter SSML.
12. **Handle mock drift** — two App tests duplicate `ReaderViewHandle`.
13. **Seek/TOC while speaking** — open question; default stop.
14. **Iframe `getContents()[0]` empty after `close`** — guard `initTTS`.
15. **Linux empty voices** — 2s timeout, disable play, i18n message; no crash.

## Recommended approach

- Speech engine in `src/lib/reader-tts.ts`. View-facing SSML/highlight in `ReaderView`. Chrome in `App` + `ReaderTtsBar`.
- Header: one icon, play ↔ pause. Bar: pause, stop, rate, voice. Space = same as header, subject to ignore list.
- Start: `initTTS('sentence', overlayHighlight)` then `from(selection|visibleRange)|start()`.
- Stop on: Stop button, book end, back to library, new book, ReaderView unmount, `bookHidden`.
- Prefs: `litera.ttsRate` / `litera.ttsVoice` only.

## Caveats / Not Found

- PRD open question (manual navigate while speaking) is unresolved; this file recommends stop as the reversible default.
- No existing TTS tests, keys, or handle methods.
- `getLocation()` does not expose `Range`; keep origin resolution inside ReaderView.
- Did not inventory lucide icons already imported beyond App’s current set (`Volume2` is not imported yet).
