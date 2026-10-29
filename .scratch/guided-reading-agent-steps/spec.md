# Spec: Agent-started guided steps — "带读第3章", "带读第三章的1-3段"

Status: resolved

## Problem Statement

In a Guided session, only the UI can make a guided step: Continue, the "Read to…" picker, "Guide up to here", skip chapter, and picking a chapter in the TOC. A reader who types "带读第3章" or "带读第三章的1-3段" gets a side question: the guided prompt says messages without a guided step "do not advance the reading". The model may read the chapter with `read_chapter` and retell it, but:

- the Guide cursor does not move, so the next Continue goes back to where the guide was;
- TOC progress, Book pane marks and Chapter recaps ignore it;
- "第3章" is not `chapterIndex` 2 (front matter and TOC sub-sections are chapters of their own), and the model has to guess from TOC titles;
- "1-3段" has no reliable mapping: blocks include headings and hard-split pieces, and no tool lists a chapter's blocks.

## Solution

The model gets a tool that asks for a guided step. The runtime builds the step with the same functions the UI uses, and sends it as an ordinary guided step (a user message with `guide`) once the current turn ends. Everything downstream (cursor, coverage, marks, recap) stays as it is, because a step is still a user message with a `guide`.

- **`list_guide_blocks(chapterIndex, after?)`.** Exposes `BookContentPort.guideBlocks`: per block its index, snippet, length, heading level and kind, so the model can map "第1-3段" and section names to block numbers. Paged like `guideOutline` for long chapters.
- **`guide_step({ chapterIndex?, toChapterIndex?, toBlock?, skim? })`.**
  - With `chapterIndex`: start at that chapter's first block, as picking a chapter in the TOC does (`guideStepAt`). Without it: start at the Guide cursor (`nextGuideStep`).
  - With `toBlock` (in `toChapterIndex`, default the start chapter): end there (`guideStepTo`). Without it: the default step, one part.
  - `skim`: as the picker's skim (`skimGuideStep` / `guideStepTo(…, skim)`).
  - Errors the model can act on: end before start, unknown chapter, not a Guided session.
  - The result is the step label; the model says one line ("好，接下来带读第三章 1-3 段") and stops. The runtime then sends the step.
- **Prompt.** The guided prompt explains when to call `guide_step` (the reader asks to be guided through a place or a range) and when not (questions about the book, which stay side questions). It tells the model to resolve "第N章" from `get_toc` titles and "第N段" with `list_guide_blocks`, skipping headings and blank or image blocks when counting paragraphs, and to ask when the place is ambiguous.

## Decisions to make

1. **Agent tool, or a front-end command?** _Decided: agent tool._ Alternative: parse "带读第N章 / 第N段" in the chat input and turn it into a picked step, no model involved. Cheaper and exact, but only for fixed phrasings and with the same chapter/paragraph mapping problems. Recommended: the tool, because the model can read TOC titles and block previews.
2. **Where a step may start.** _Decided: (a), refuse a mid-chapter start and offer the chapter start instead._ Today a step starts at the cursor, or at a chapter's first block after a TOC pick. "第3章1-3段" fits (chapter start to block). "第3章5-7段" starts mid-chapter, which spec `guided-reading-ranges` put out of scope ("steps that start anywhere other than the cursor"). Options: (a) refuse a mid-chapter start and offer "from the chapter start to 7" instead; (b) allow any start, leaving a gap that coverage shows as unread. Recommended: (a).
3. **Send at once, or propose?** _Decided: send at once._ The runtime could send the step right away, or show it as the picked step for the reader to confirm with Continue. Sending at once matches what the reader asked; proposing guards against a wrong mapping. Recommended: send at once, since the label shows the range and the reader can go on from there.
4. **How the step is sent.** _Decided: follow-up message._ As a follow-up user message after the turn (the turn with the tool call stays a side question), versus turning the current user message into the guided step. Recommended: follow-up message; it keeps "a step is a user message with `guide`" and needs no session rewriting.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | `list_guide_blocks` tool | resolved | — |
| 02 | `guide_step` tool, sent as a follow-up step | resolved | — |
| 03 | Guided prompt: when and how to start a step | resolved | 01, 02 |
| 04 | Show guided steps as transcript markers | resolved | 02 |

## User Stories

1. As a reader in a Guided session, I want to say "带读第3章", so that the guide moves to chapter 3 without my finding it in the TOC.
2. As a reader, I want to say "带读第三章的1-3段", so that I can set a small step by talking.
3. As a reader, I want a step the agent started to count like any other, so that progress, marks and recaps stay right.
4. As a reader asking an ordinary question, I want it to stay a side question, so that the reading does not jump.

## Out of Scope

- Going back over read parts (re-reading); still a side question.
- Changing block cutting or how the Book is cut into chapters.
- Non-guided sessions.
