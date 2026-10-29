# Spec: Guided reading ranges — the reader picks how far each step reads

Status: resolved

## Problem Statement

A guided step is always one `read_chapter` part of one TOC chapter. Two cases read badly:

1. **Many short sections.** A chapter whose TOC lists many sub-sections of two or three paragraphs becomes many chapters (`buildOwnedChapters` gives each TOC leaf its own chapter). The guide then takes one step, and writes one Chapter recap, per tiny section.
2. **No finer control.** A reader who wants to go slowly through a dense passage cannot ask for a few paragraphs; the smallest step is a whole part (up to `CHAPTER_PART_CHARS`).

The reader, not the app, should decide where a step ends. Automatic merging was considered and rejected.

## Solution

- **A step is a range of paragraphs.** It runs from the paragraph after the Guide cursor to an end paragraph the reader picks, possibly in a later chapter. The start is always the cursor: no gaps, the reading stays in order. Jumping elsewhere stays with the existing skip / pick-a-chapter.
- **Continue keeps its default.** Without a pick, Continue reads the next part, as now. If the cursor is inside a part (an earlier pick ended there), Continue reads the rest of that part.
- **Two ways to pick the end.**
  - A "Read to…" picker next to Continue in the GuideBar: the paragraphs after the cursor, grouped under their section headings, each with a first-line preview and length. Tapping a paragraph ends the step there; tapping a heading ends it at the end of that section.
  - "Guide up to here" in the reader's selection toolbar: the selected text's paragraph becomes the end.
- **Skim takes a range too.** The picker offers skim for the chosen range.
- **One recap per step that finishes chapters.** When one step finishes several chapters, they get one recap together instead of one each.

## User Stories

1. As a reader of a chapter with many short sections, I want to read several of them in one step, so that I am not stepping through two-paragraph fragments.
2. As a reader of a dense passage, I want to read just a few paragraphs, so that each explanation stays focused.
3. As a reader, I want to pick where the step ends from a list or from a selection in the book, so that I decide the pace.
4. As a reader who does not pick anything, I want Continue to behave as before.
5. As a reader with an older Guided session, I want it to continue where it was.

## Implementation Decisions

- **Block.** The unit is a block of the chapter Markdown as `windowBlocks` cuts it (a `\n\n` paragraph, or a hard-split piece of an oversize one). Parts are runs of blocks, so a part maps exactly onto a block range.
- **Step shape.** `GuideStep` gains `from` / `to` positions (`{ chapterIndex, block, snippet? }`, `to` inclusive). `snippet` is the start of the block's text, used to find the block again when cutting changes, as `chapterTitle` does for chapter indices. `part` / `totalParts` stay for reading older steps; an old step converts to the block range of its part (via the existing share mapping when the part count changed).
- **Guide cursor.** The `to` of the latest guided step on the active branch. Still derived, never stored. Update the Guide cursor entry in `CONTEXT.md` (done: also a new Guided step entry).
- **Reading a range.** `read_chapter` accepts an optional block range (`fromBlock`, `toBlock`). A range longer than `CHAPTER_PART_CHARS` is split into sub-ranges with the same cut costs as `chapterWindows`; the step context lists every read the model must make in the same turn. A range across chapters lists one or more reads per chapter.
- **Step context.** States the exact range and asks the model to cover only it ("stay within this range"; say so if it ends mid-argument).
- **Book port.** A new `guideBlocks(chapterIndex)` (or a TOC extension) returns each block's preview, length, heading level and part number, for the picker and for converting parts.
- **Selection to block.** From the selection's `chapterHref` (`chapterForHref`) and its text, find the block with the same matching as `locateQuote`. No CFI-to-Markdown mapping.
- **Coverage.** `chapterCoverage` tracks covered blocks per chapter. A chapter is finished when all its blocks are covered; TOC progress shows the covered share.
- **Size warning.** The picker warns when a range is longer than about two parts; it does not forbid it.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Block-range guided steps | resolved | — |
| 02 | "Read to…" picker in the GuideBar | resolved | 01 |
| 03 | "Guide up to here" from a reader selection | resolved | 01 |
| 04 | One recap for a step that finishes several chapters | resolved | 01 |
| 05 | Guide marks in the Book pane, and exact "Guide up to here" | resolved | 03 |

## Out of Scope

- Automatic merging of short chapters or sections.
- Steps that start anywhere other than the cursor.
- Changing how the Book is cut into chapters (`buildOwnedChapters`) or the default part cutting.
