# Implement: Reader TTS playback

## Checklist

1. **Types** — extend `src/foliate-js.d.ts` with `TTS`, `initTTS`, renderer contents/overlayer, `lastLocation.range`. No `any`.
2. **Pure helpers** — add `src/lib/reader-tts.ts` + `src/lib/reader-tts.test.ts`:
   - `parseSsmlMarks`
   - rate clamp / load / save (`litera.ttsRate`)
   - voiceURI load / save (`litera.ttsVoice`)
   - `pickDefaultVoice`
   - overlay key + highlight color constants
3. **ReaderView** — custom TTS overlay highlight; handle methods from `design.md`; `autoAdvance` flag; `advanceTtsSection`; do not leak Range. On `create-overlay`, re-apply current TTS overlay if any. Unmount / book change clears overlay.
4. **Hook** — `src/lib/use-reader-tts.ts` (+ tests with mocked `speechSynthesis` and reader handle): state machine, utterance queue, cancel-based pause, user-relocate restart, stop on unmount / hidden book / file change.
5. **Chrome** — `src/components/ReaderTtsBar.tsx` (+ test); toolbar button in `App.tsx`; Space in `ReaderView` with an extended ignore list (`BUTTON` / slider); bar above `ReaderProgressBar`.
6. **i18n** — all new strings in `src/locales/zh-CN.ts` and `src/locales/en.ts` (play, pause, stop, rate, voice, no-voices, aria-labels). Key parity stays green.
7. **Tests** — update `App.reader-mode.test.tsx` / `App.annotations.test.tsx` reader handle mocks with new methods. Add a focused chrome test for button + bar visibility + space ignored in input.
8. **Lint / typecheck** — `npx tsc --noEmit` and `npx vitest run` for touched tests.

## Validation

```bash
npx vitest run src/lib/reader-tts.test.ts src/lib/use-reader-tts.test.ts src/lib/reader-paging.test.ts src/components/ReaderTtsBar.test.tsx src/App.reader-mode.test.tsx src/lib/i18n.test.ts
npx tsc --noEmit
```

Manual (after code lands, before commit): open an EPUB, play / pause / stop, space, selection start, auto page, TOC jump continues, back-to-library silences, missing-voice path if you can stub `getVoices()`.

## Risky files / rollback

| File | Risk |
|---|---|
| `src/components/ReaderView.tsx` | relocate / load / overlay already dense; TTS highlight must not fire SelectionToolbar or persist annotations |
| `src/App.tsx` | header crowding; space must not steal chat composer |
| `src/foliate-js/**` | **do not edit** |
| `src-tauri/src/preferences.rs` | **do not edit** |

If the loop desyncs (audio vs page): stop() and clear overlay; do not leave `speechSynthesis` speaking after unmount.

## Follow-up before `task.py start`

- `prd.md` / `design.md` / `implement.md` reviewed by user
- `implement.jsonl` and `check.jsonl` have real spec/research entries
- Research under `research/` consulted for SSML and `initTTS` early-return
