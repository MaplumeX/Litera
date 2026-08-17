# Research: Web Speech API + SSML in Tauri 2

- Query: How Web Speech works in Tauri WebViews; how hosts turn foliate-js SSML into spoken text + setMark; rate, voices, pause/cancel, onend/onerror, no-voices
- Scope: mixed
- Date: 2026-08-17

## Findings

### Files Found

| File Path | Description |
|---|---|
| `src/foliate-js/tts.js` | Emits SSML strings; does not speak |
| `src/foliate-js/README.md:286-290` | “feed to your speech synthesizer” |
| Foliate GTK `src/tts.js` + `src/speech.js` (upstream gtk4) | Speech Dispatcher SSML + mark events |
| Readest `WebSpeechClient.ts` + `utils/ssml.ts` | Parse marks → one utterance per mark |

### Official / source URLs

- Web Speech API (WICG): https://webaudio.github.io/web-speech-api/
- SpeechSynthesis interface: https://webaudio.github.io/web-speech-api/#tts-section
- MDN `SpeechSynthesisUtterance.rate`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/rate
- MDN `SpeechSynthesisUtterance.text` (SSML *or* plain; unsupported tags stripped): https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance/text
- MDN `SpeechSynthesis.getVoices`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices
- MDN `SpeechSynthesisErrorEvent.error` (`canceled` / `interrupted` / `synthesis-unavailable` / `synthesis-failed` / `audio-busy` / `not-allowed`): https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisErrorEvent/error
- MDN `SpeechSynthesis.cancel`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/cancel
- SSML 1.0 `<mark>`: https://www.w3.org/TR/speech-synthesis/#S3.3.2
- Tauri 2 WebView versions: https://v2.tauri.app/reference/webview-versions/
- Tauri Linux `speechSynthesis` discussion: https://github.com/orgs/tauri-apps/discussions/8784
- Chromium 15s utterance cutoff: https://issues.chromium.org/40747712
- Edge 2016 SSML + `onmark` (legacy Edge, not Chromium): https://blogs.windows.com/msedgedev/2016/06/01/introducing-speech-synthesis-api/
- Foliate GTK TTS (gtk4): https://raw.githubusercontent.com/johnfactotum/foliate/gtk4/src/tts.js
- Foliate SSIP / Speech Dispatcher: https://raw.githubusercontent.com/johnfactotum/foliate/gtk4/src/speech.js
- Foliate viewer wiring (`init` / `start` / `highlight` → `setMark`): https://github.com/johnfactotum/foliate/blob/gtk4/src/book-viewer.js
- Readest `WebSpeechClient`: https://raw.githubusercontent.com/readest/readest/main/apps/readest-app/src/services/tts/WebSpeechClient.ts
- Readest `parseSSMLMarks`: https://raw.githubusercontent.com/readest/readest/main/apps/readest-app/src/utils/ssml.ts

### Tauri 2 WebView map

| OS | Engine | SpeechSynthesis reality |
|---|---|---|
| Windows | WebView2 = Edge/Chromium | Works. Voices = OS SAPI + Microsoft Online. `getVoices()` often empty until `voiceschanged`. Long utterances (~15s) can die unless chunked or `resume()` keepalive. |
| macOS | WKWebView = WebKit | Works via AVSpeech. `getVoices()` lists many `com.apple.*` URIs; **enhanced/premium** often fail and fall back to compact. Readest keeps `com.apple.voice.compact` only. `pause`/`resume` generally work. |
| Linux | WebKitGTK | **Unreliable.** Synthesis is supposed to go through [Speech Dispatcher](https://github.com/brailcom/speechd). Empty voice list if `speech-dispatcher` + a module (`espeak-ng`, `festival`, Piper, …) are missing. Tauri discussion #8784: stock WebKitGTK may not fully expose `speechSynthesis`; some distros/Flatpaks cannot spawn the daemon. PRD R8: Linux 中文音质取决于系统语音, this round does not compensate. |

`window.speechSynthesis` may exist as an object while `getVoices()` stays `[]`. Treat **zero voices after timeout** as a hard failure, not “API missing”.

There is no Tauri plugin required. Call the WebView’s `window.speechSynthesis` from the React frontend. Do not add a Rust TTS crate this task.

### SSML support is incomplete — do not feed foliate SSML to `utterance.text`

Spec (WICG + MDN): `utterance.text` *may* be a well-formed SSML document; engines that do not support SSML **strip tags and speak the remainder**.

In practice:

| Engine | SSML | `onmark` | Word `onboundary` |
|---|---|---|---|
| Chromium / WebView2 (current) | Tags stripped; `<mark>` not honored | Does not fire | `name: "word"` / `"sentence"` + `charIndex` on **plain** text |
| WebKit / WKWebView / WebKitGTK | Tags stripped | Does not fire | Partial / often missing |
| Legacy Edge (2016, not WebView2) | Real SSML + `onmark` | Yes | Yes |
| Foliate GTK Speech Dispatcher | `SET SELF SSML_MODE on` | Mark name via SSIP event 7xx | N/A (native daemon) |

Foliate-js SSML contains `<mark name="0"/>` plus `<emphasis>`, `<break/>`, `<lang>`, `<phoneme>`. If you assign that string to `utterance.text` in Chromium/WebKit:

- The engine speaks concatenated text (marks vanish).
- `onmark` never runs → `setMark` never runs → **no follow highlight**.
- `charIndex` does not line up with mark names because XML/NS prefixes shift offsets.

### How hosts get mark callbacks anyway

**Foliate GTK** (not Web Speech): `SSIPClient.speak(ssml)` sends the raw SSML to speech-dispatcher. Iterator yields `{ mark }` / `{ message: 'END' }`. Navbar:

```
'init'      → view.initTTS()
'start'     → view.tts.start()          // SSML string
'resume'    → view.tts.resume()
'forward'   → view.tts.next()
'highlight' → view.tts.setMark(mark)    // daemon mark name
'next-section' → view.next().then(() => true)
```

(`book-viewer.js` “TTS” block; `tts.js` `#speak` loops `for await ({ mark, message })`.)

Rate change: **stop, set RATE, restart** (`tts.js` `#connectScale`). They do not mutate a live utterance.

**Readest WebSpeechClient** (the pattern Litera should copy):

1. `parseSSMLMarks(ssml)` walks tags, builds `{ name, text, language, offset }[]` and a `plainText`.
2. For each mark: `dispatchSpeakMark(mark)` → host `tts.setMark(mark.name)` **before** audio.
3. `utterance.text = mark.text` (plain). Set `rate`, `pitch`, `voice`, `lang`.
4. `synth.speak(utterance)`; await `onend` / `onerror`.
5. `getGranularities()` returns **`['sentence']` only**. They disable word granularity because you cannot change voice mid-utterance, and Web Speech has no reliable mark stream.

Readest also strips `<emphasis>` / em-dashes / `<break/>` in a preprocess step (`TTSController.#preprocessSSML`) because leftover tags become audible or cause long pauses.

**Litera recommended approach** (PRD R5 sentence highlight, R8 Web Speech only):

1. `initTTS('sentence', highlight)`.
2. Parse the returned SSML with a small `parseSsmlMarks(ssml)` (port the Readest loop; do not import Readest). Skip marks whose text is empty or punctuation-only (`/^[\p{P}\p{S}]+$/u`).
3. Speak **one utterance per mark**. On start: `tts.setMark(name)`.
4. On last mark `onend`: `tts.next()`; if `undefined`, turn to next section, `initTTS`, `start()`.
5. Never assign the raw SSML string to `utterance.text`.

Sentence-sized chunks also dodge Chromium’s ~15s utterance watchdog.

### Rate

- Spec / MDN: `utterance.rate` is **0.1 … 10**, default `1`. `2` = 2×, `0.5` = half. Engines may clamp further.
- Set on the **utterance**, not on `speechSynthesis`.
- Changing rate mid-speech: create a new utterance. Foliate GTK: stop → setRate → start. Readest: store `#rate` and apply on the next utterance; WebSpeech `getCapabilities().liveRateChange === false`.
- UX: do not expose 0.1–10. Common reader presets: `0.75 / 1 / 1.25 / 1.5 / 1.75 / 2` (Readest also added 0.8 / 0.85). Clamp stored value to e.g. `0.5 … 3`.
- Persist in `localStorage` (see integration research), not `preferences.json`.

### Voices

```js
const list = speechSynthesis.getVoices()          // may be []
speechSynthesis.addEventListener('voiceschanged', …)
```

- Chromium: first `getVoices()` is empty; `voiceschanged` fires once (sometimes more).
- WebKit: often already populated; `onvoiceschanged` may be `undefined`.
- Linux with no daemon: **empty forever, event never fires**.

Readest `WEB_SPEECH_VOICES_TIMEOUT_MS = 2000`: if still empty, continue with `[]` and do not deadlock init.

Identify a voice by `voice.voiceURI` (stable-ish) not by array index. Persist that string. On load: `voices.find(v => v.voiceURI === saved)`; if missing, pick `voice.default` or first voice whose `lang` matches the book / UI locale (`zh-*` then `en`).

`utterance.voice = SpeechSynthesisVoice` object (must be from the current `getVoices()` list, not a cloned POJO). Also set `utterance.lang`.

No-voices failure: disable play, show an i18n error (e.g. Linux: install `speech-dispatcher` + `espeak-ng`). Do not call `speak()`.

### Pause vs cancel

| Call | Effect | Events |
|---|---|---|
| `speechSynthesis.pause()` | Pause current + queue | `onpause`; `speechSynthesis.paused === true` |
| `speechSynthesis.resume()` | Continue | `onresume` |
| `speechSynthesis.cancel()` | Stop now, **clear the queue** | current: `onerror` `interrupted`; queued: `onerror` `canceled`; **`onend` may not fire** |

Caveats:

- **Android / some Chromium**: `pause()` behaves like `cancel()`. Desktop WebView2 is better but not perfect.
- Chromium desktop: paused/playing utterances can freeze after ~15s unless something calls `resume()` periodically (the “resume every 14s” workaround). Sentence chunks make this mostly irrelevant.
- After `cancel()`, `speaking` and `pending` become false. `resume()` does nothing — you must `speak()` again.
- `tts.resume()` in foliate-js is **not** `speechSynthesis.resume()`. It returns SSML from `#lastMark`. After `cancel()`, call `tts.resume()` and speak that SSML (marks after the last `setMark`).

**Recommended Litera policy:**

- Pause: try `speechSynthesis.pause()`. If `!speechSynthesis.paused` after a turn (broken pause), `cancel()` and treat state as `stop-paused`; Play calls `tts.resume()` + new utterances.
- Stop / leave page / change book: always `cancel()`. Ignore `canceled`/`interrupted`.
- Rate or voice change while playing: `cancel()`, apply new settings, `tts.resume()`, speak.

### `onend` vs `onerror`

```js
utterance.onend = () => { /* advance to next mark / next() */ }
utterance.onerror = (ev) => {
  if (ev.error === 'canceled' || ev.error === 'interrupted') return // not fatal
  if (ev.error === 'synthesis-unavailable' || ev.error === 'synthesis-failed') // no engine
  // else stop + show error
}
```

Do **not** advance on `canceled`/`interrupted` — that is Stop or a handover `cancel()` before the next utterance. If you treat them as `end`, you skip sentences.

`not-allowed`: speak() without a user gesture. First Play must be in the click/space handler (not a `setTimeout` after navigate). Subsequent sentence `speak()` calls are usually allowed once a session started.

### No-voices / missing API

```
typeof speechSynthesis === 'undefined'     → API absent (very old WebView)
getVoices() still [] after 2s              → no system voices
onerror synthesis-unavailable              → daemon/engine down
```

Surface a non-fatal chrome message. Keep the play button visible but disabled so the user knows the feature exists.

### Rate / voice persistence (API-adjacent)

Store `{ rate: number, voiceURI: string }` in `localStorage`. Apply to every new `SpeechSynthesisUtterance`. Do not write `preferences.json` (`deny_unknown_fields`).

## Recommended module shape

`src/lib/reader-tts.ts` (plain functions + a small controller, no React Context):

- `loadTtsPrefs()` / `saveTtsPrefs()` — `litera.ttsRate`, `litera.ttsVoice` (same try/catch as `reader-mode.ts`).
- `waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]>`
- `parseSsmlMarks(ssml: string): { name: string; text: string }[]`
- `TtsPlayer` with `play(ssml)`, `pause()`, `stop()`, `setRate`, `setVoice`, `onMark`, `onIdle` (need next SSML), `onError`.

Keep `speechSynthesis` calls out of `ReaderView.tsx` so tests can mock the player.

## Caveats / Not Found

- Did not run `speechSynthesis` inside this repo’s WebView; Linux WebKitGTK behavior is from Tauri #8784 + Speech Dispatcher docs, not a live probe.
- WebView2 SSML: current Edge is Chromium — assume **no** real SSML/`onmark`, even though 2016 Edge blog advertised it.
- `utterance.onboundary` charIndex is usable only if you speak **plainText of the whole block** and map offsets via `parseSSMLMarks.offset`. One-utterance-per-mark is simpler and matches R5.
- iOS/WKWebView “must speak from a user gesture” is more strict than desktop WKWebView; Tauri macOS desktop is the latter.
