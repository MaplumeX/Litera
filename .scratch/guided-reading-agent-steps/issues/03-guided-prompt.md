# 03: Guided prompt: when and how to start a step

**Status:** resolved

**Blocked by:** 01, 02

**What to build:** Teach the model, in `guidedPrompt`'s fixed mechanics (not the editable style), to start guided steps on request.

- [x] "Messages without a guided step … do not advance the reading" now has one exception: when the reader asks to be guided through a place or range ("带读第3章", "带读第三章的1-3段", "略读下一章", "读到这一节末尾"), call `guide_step` instead of retelling, and answer with one short line
- [x] Resolve "第N章" from TOC titles and paths, not by counting; resolve paragraphs and section starts with `list_guide_blocks`, counting only text blocks
- [x] Ask when the place is ambiguous; for a mid-chapter start, offer the range from the chapter start or from the cursor
- [x] Tests: prompt contents, with the default and a custom style (`guide.test.ts`); an embedded-runtime test with a scripted model that calls `get_toc`, `list_guide_blocks`, `guide_step`

## Comments

- `CONTEXT.md` Guided step entry updated: a step starts at the cursor or at a picked chapter's start, never mid-chapter, and the reader can ask the assistant for it.
- Whether real models follow the prompt (pick `guide_step` over retelling, map "第3章" correctly) is not verified; it needs a try in the running app with the configured model.
