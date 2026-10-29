# 03: Guided prompt: rules move into the tools

**Status:** resolved

**Blocked by:** 01

**What to build:** The guided prompt keeps the role, style, skimming and recaps; the rules about steps live in the `guide_step` description and its errors.

- [x] Prompt: "guide_step is how the guide moves on"; no side-question exception, no step rules
- [x] `guide_step` description: when to call it, start and end, no mid-chapter start, finding chapters (TOC titles, not counting) and paragraphs (`list_guide_blocks`), asking when ambiguous
- [x] Tests: `guide.test.ts` (`guidedPrompt`)
