# Design: Reader TTS playback

## Boundaries

| Layer | Owns | Does not own |
|---|---|---|
| `src/lib/reader-tts.ts` | SSML → marks, rate/voice parse + `localStorage`, default voice pick | DOM, SpeechSynthesis, React |
| `src/lib/use-reader-tts.ts` | Playback state machine, utterance queue, `speechSynthesis` | Foliate `Range` / overlayer |
| `ReaderView` | `initTTS`, `from` / `next` / `resume` / `setMark`, TTS overlay, auto-advance chapter | Chrome UI, persistence |
| `App.tsx` + `ReaderTtsBar` | 顶栏按钮、底条、空格（与聊天/设置共存） | 发声循环细节 |
| `src/foliate-js.d.ts` | `initTTS` / `TTS` / renderer types | 子模块源码 |

Do not edit `src/foliate-js/**` (submodule). Do not add keys to `preferences.json` / `save_preferences`. Do not call `startMediaOverlay`.

## Data flow

```
Play
  → ReaderView.initTts('sentence', drawOverlay)
  → ssml = selection Range ? tts.from(sel)
           : lastLocation.range ? tts.from(visible)
           : tts.start()
  → parseSsmlMarks(ssml) → [{ name, text }]
  → for each mark: SpeechSynthesisUtterance(text)
        onstart → tts.setMark(name)
        onend   → next mark
  → marks exhausted → tts.next()
        if SSML → speak that block
        if undefined → ReaderView.advanceSection()
              (flag autoAdvance, view.next(), wait load, initTts, tts.start())
              if no new section → stop
Pause
  → speechSynthesis.cancel()  (do not rely on pause(); WebKitGTK/Linux is unreliable)
  → keep last mark / remaining queue
  → resume via tts.resume() or leftover marks
Stop / unmount / hide book
  → cancel, clear overlay, status = idle, hide bar
User relocate while playing/paused
  → if autoAdvance flag: ignore
  → else cancel current utterance, initTts if doc changed, from(new visible range)
```

## Contracts

### SSML

Web Speech does not honor foliate SSML. `parseSsmlMarks(ssml)` walks `<mark name>` and takes following text nodes (skipping other markup). Empty text marks are dropped. If parsing yields nothing, fall back to all text content as one unnamed utterance (no `setMark`).

Speak **one mark per utterance** so highlight stays sentence-aligned with `granularity: 'sentence'`. Do not drive highlight from `onboundary` word events.

### ReaderView handle (additive)

```ts
initTts(): Promise<boolean>
ttsSpeakOrigin(): string | undefined   // SSML
ttsNext(): string | undefined
ttsResume(): string | undefined
ttsSetMark(mark: string): void
clearTtsHighlight(): void
advanceTtsSection(): Promise<string | undefined>
```

Ranges stay inside ReaderView. `getLocation()` stays CFI/fraction only.

Highlight: overlayer key `litera-tts` (never a CFI). `Overlayer.highlight` with a color distinct from user `#fbbf24`. `scrollToAnchor(range, false)` only when the range is off-screen. Never `addAnnotation`. Never default `initTTS` highlight (`select=true` opens SelectionToolbar).

`advanceTtsSection` sets an internal `autoAdvance` flag around `view.next()` + `load`. User click/wheel/TOC/seek/CFI jump does not set the flag.

`initTts` must pass a stable highlight closure. Changing highlight/granularity on the same doc requires `view.tts = null` first (`initTTS` early-returns on `tts.doc === doc`). Guard `getContents()[0]` — empty contents throw.

### Playback state

`idle | playing | paused`. Bar visible iff not `idle`.

Rate: `0.5–2.0`, step `0.1`, default `1`. Voice: persist `SpeechSynthesisVoice.voiceURI`. Keys: `litera.ttsRate`, `litera.ttsVoice` (same flat `litera.*` style as `litera.uiFontSize`). Missing / invalid → defaults. Default voice: first voice whose `lang` matches `document.documentElement.lang` or book language; else first voice.

No voices: stay `idle`, surface `t("reader.tts.noVoices")`, do not throw.

### Chrome

- Header: lucide speaker / pause, `size="icon-sm"`, `aria-label` via `useT()`. Place with typography button (book-side tools). Hidden on library. Disabled when book cell is hidden; `bookHidden` also stops playback (ReaderView stays mounted).
- Bar: `ReaderTtsBar` above `ReaderProgressBar`, same book cell. Pause, stop, rate slider (`Slider`), voice `Select`. Flat border chrome, no extra shadow.
- Space: bind in `ReaderView` `handleKeyDown` (window + iframe), same as arrows, so chapter iframe focus still works. For Space only, ignore `BUTTON` / `[role=button]` / `[role=slider]` / `input[type=range]` in addition to `shouldIgnorePagingTarget` (avoid double-toggle and rate-slider steal). Chat textarea is already ignored.

### Types

Extend `src/foliate-js.d.ts` `View` with `initTTS`, `tts`, `renderer.getContents`, `lastLocation.range`, `close`. Type `TTS` methods as sync `string | undefined`. No `any`.

## Compatibility

- Frontend-only. Old `preferences.json` unchanged.
- First play after voices load: listen once to `voiceschanged` if `getVoices()` is empty.
- Book switch: `ReaderView` already `close()`s; hook must `stop()` on `fileData` change and unmount.

## Trade-offs

| Choice | Why |
|---|---|
| Cancel instead of `speechSynthesis.pause()` | Pause is flaky on WebKitGTK; cancel + `resume()`/`from` is deterministic |
| One utterance per sentence mark | Matches R6; SSML marks are unused by the engine |
| Overlay key not CFI | Isolates TTS from annotation persistence |
| Hook in App, Ranges in ReaderView | Matches existing chrome vs view split |

## Risks

- Chromium/WebView2 can cut utterances around 15s. Sentence marks are usually shorter; if a mark is huge, split by length in `parseSsmlMarks` later — not required for MVP.
- Linux needs `speech-dispatcher` plus a voice module. Empty `getVoices()` after timeout is a hard failure (AC10), not a retry loop.
- `canceled` / `interrupted` error events are expected after `cancel()`; do not surface them as AC10 failures.

## Rollback

Delete new lib/components, revert `ReaderView` handle / `App` chrome / locales / `foliate-js.d.ts`. No Rust or data-migration rollback.
