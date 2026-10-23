# 02: Guided step and Continue

**Status:** resolved

**What to build:** In a Guided session a Continue button above the chat input sends the next guided step. The app computes the step from the guide cursor; the model reads exactly that part and retells it.

- [x] User-message entries for guided steps carry `guide: { chapterIndex, part, mode }`
- [x] Guide cursor = latest `guide` on the active branch; before any step it is the chosen start chapter, part 0
- [x] Next step: next part of the same chapter, else part 0 of the next chapter (TOC order, using part counts); at the end of the Book Continue is disabled with an "end of book" note
- [x] Visible message is a short label; the model-facing prompt names the chapterIndex and part to read with `read_chapter`
- [x] Free questions in a Guided session do not carry `guide` and do not move the cursor
- [x] Editing or branching back moves the cursor with the branch
- [x] Tests: cursor derivation (incl. branches), next-step computation across chapter boundaries and end of book, prompt carries the guide field

**Notes:** Mirror how `selection` and `chapterHref` travel through `prompt()` in `src/agent/runtime/embedded-runtime.ts`. Part counts come from the TOC (`parts`) already used by the snapshot.

## Comments

- Next-step logic is pure, in `src/agent/runtime/guide.ts` (`nextGuideStep`, `resolveGuideStep`); chapters with no text of their own (volume headings) are skipped.
- The visible user message is a localized label ("带读：第三章（第 1/3 部分）"), which also tells the model what language to write in. The exact `read_chapter` call goes in the hidden readingContext entry.
- The runtime re-resolves a step against the open Book before sending, so a stale part count or title is corrected and an out-of-range step is refused before anything is persisted.
- Guided steps cannot be edited (no pencil); regenerate re-sends the same step.
- The default style prompt (`GUIDED_PROMPT`) landed here so steps work end to end; making it editable in settings is still issue 03.
