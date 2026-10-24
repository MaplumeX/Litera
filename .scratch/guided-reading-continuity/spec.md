# Spec: Guided reading continuity — chapter recaps and section-aligned parts

Status: resolved

## Problem Statement

Guided reading promises a complete, coherent retelling of the Book. Two things work against that on real books:

1. **The guide forgets earlier chapters.** The style asks the assistant to connect back to earlier material, but a long Guided session outgrows the model's context: Pruning drops the chapter text and Compaction folds the old retellings into a generic conversation summary. By chapter 10 the assistant no longer knows what chapter 2 said.
2. **Parts cut sections in odd places.** `read_chapter` windows are paragraph-aligned but packed greedily: a section heading can land at the very end of a part, a part can stop two paragraphs into a new section, and the last part of a chapter is often a short tail. Each guided step then starts or ends mid-thought.

## Solution

- **Chapter recap.** When the guide finishes a chapter (its last part, or a skim), the app asks the model for a short recap of what the retellings of that chapter covered and records it in the Session, right after the step. The reader sees it as a collapsible "Chapter recap" marker in the transcript. The model keeps every recap in its context for the rest of the Session: Compaction does not fold recaps into its summary, and they stay in the context after it.
- **Section-aligned parts.** Chapter windows still hold at most `CHAPTER_PART_CHARS`, but the cut points are chosen, not greedy: prefer cutting just before a heading or a scene break, never right after a heading, and keep the parts of a chapter about equal in size. A chapter may gain one part when that lets every cut fall on a section boundary.

## User Stories

1. As a reader in a long Guided session, I want the assistant to still know what earlier chapters said, so that its links back to them are right.
2. As a reader, I want a short recap when a chapter ends, so that I can review the chapter's main line before moving on.
3. As a reader, I want each guided step to start and end at a natural break, so that a section is not split in a strange place.
4. As a reader with a Guided session made before this change, I want Continue to pick up roughly where I was, even if the chapter's part count changed.

## Implementation Decisions

- **Recap entry.** A `custom_message` entry with `customType: "guideRecap"`, `details: { chapterIndex, chapterTitle? }`, content the recap text prefixed for the model ("Chapter recap — chapterIndex N …"). Part of the active branch, so branching, editing and regenerating drop or keep it naturally. No new persisted entity, no Manifest change.
- **When it is written.** After a turn in a Guided session completes, in the same background task as context maintenance and before it (the next prompt already waits for that task). A chapter is due when the active branch's guided steps cover all its parts and it has no recap on the branch. One recap per run, oldest due chapter first, so Sessions from before this change backfill one chapter per turn. Failures are logged and retried after the next turn.
- **Recap input.** The assistant text of the guided steps of that chapter on the active branch (the full transcript, not the compacted context). Side questions are not included. A standalone model call (no prompt cache, like titles and summaries), capped output.
- **Context projection.** `contextBranch` keeps recap entries that a Compaction cut off, placing them right after the compaction summary in branch order. `serializeConversation` skips recaps, so a summary does not repeat them.
- **Transcript.** Recaps are a new transcript marker (`role: "recap"`), anchored like compaction notices so edit indices stay aligned. Collapsed by default; shows the chapter title.
- **Part cutting.** `chapterWindows` picks cuts by minimal cost with dynamic programming over the paragraph blocks, for the greedy (minimal) part count and that count + 1. Costs: before a heading of level 1–2 = 0, before a level 3–6 heading or scene break = 0.25, other paragraph boundary = 1, right after a heading = 50, inside a hard-split block = 0; plus a squared size-imbalance term per part and a penalty for the extra part. Windows still rejoin to the chapter Markdown. Single-window chapters are unchanged.
- **Search hits.** A hit's `part` is the window that holds it (`partAt` in `epub-content.ts`): the flat-text offset is placed by its share of the chapter's comparison-form text, then the nearest window containing the match wins. It used to be the flat offset divided by `CHAPTER_PART_CHARS`, which pointed to the wrong part once Markdown and flat text drifted apart.
- **Old cursors.** When a step's `totalParts` differs from the chapter's current part count, the next step maps the covered fraction onto the new parts, rounding so that text may repeat rather than be skipped.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Section-aligned chapter parts | resolved | — |
| 02 | Chapter recaps in Guided sessions | resolved | — |

## Out of Scope

- Recaps shared across Sessions or Books (the persisted per-book retelling of guided-reading phase 2).
- Recaps for chapters left part-way (skipped mid-chapter).
- Editing or regenerating a recap by hand.
