# Spec: Guided reading redesign — book-level guide, sliding context, inline images, page guide cards, and book-wide recaps

Status: resolved

## Problem Statement

A Guided session today runs on the same model as an ordinary linear chat Session, with several structural friction points:

1. **Context growth vs. fragmentation.** Keeping a whole book in one Guided session lets context grow to ~85% of the window before generic Compaction fires, driving up token cost and degrading attention. Splitting into one Guided session per chapter keeps context clean, but fragments reading progress, Book pane marks, Chapter recaps, and continuity across chapters.
2. **Extra LLM round-trip on every step.** `guide_step` only returns instructions to call `read_chapter`, forcing two tool loops per Continue press. Meanwhile, Continue asks the model to stop at a natural break near the default end, but `guideReadingState` never tells the model where nearby section headings are.
3. **Images in guided steps are disconnected.** Readers of illustrated or diagram-heavy books only see text retelling and must flip back to the Book pane to view figures.
4. **No reverse lookup from the Book pane.** The Book pane marks read paragraphs, but readers re-reading the Book cannot inspect the assistant's explanation for a paragraph without hunting through the transcript.
5. **Chapter recaps are buried and generic.** Recaps live only as scattered collapsed rows in a long transcript, with no unified book-wide overview, export, or synthesis for humanities/social-science reading (where thesis progression, core concepts, intellectual interlocutors, and substantive footnotes matter more than fictional cast lists).

## Core Decisions

1. **One canonical Guided session per Book (1A).** Each Book has a single primary Guided session. Creating a second Guided session is removed from the normal UI; re-reading a chapter or trying another angle uses branching/re-explaining in place (with an archive-and-restart escape hatch in guide settings for a full second read-through). Legacy books that already have multiple Guided sessions keep them readable/accessible without data loss.
2. **Coherence-leaning sliding context with Recap relay (2).** Rather than waiting for generic Compaction at 85% of the context window, Guided sessions maintain a bounded short-term working window (~30k–40k tokens target ceiling) that advances in batches—preserving Prompt Cache stability across several steps while keeping the most recent 2–3 steps intact across chapter boundaries so transitions stay smooth. Earlier finished chapters drop out of raw context once their `Chapter recap` exists, with all recaps kept in long-term context.
3. **Automatic window clear on non-adjacent chapter jumps (3).** Jumping via TOC or `guide_step(chapterIndex)` to a chapter not adjacent to the active window immediately advances the window boundary so the new chapter starts clean with `bookSnapshot` + existing `Chapter recaps` only. Readers also get a manual "reset context (keep recaps)" divider and a compact context-level indicator.
4. **Book-wide recap drawer instead of a Living Glossary (Direction 1).** For humanities and social-science books, skip spoiler-guarded character/entity glossaries. Instead, strengthen `Chapter recap` for argument/concept/interlocutor structure, surface all recaps in a unified book-wide drawer (with Markdown export and one-click whole-book argument mind map via `draw_mindmap`), and add `search_guide_history` so the model can recall earlier discussion details on demand.

## Solution Overview

### 1. Single Book-Level Guide (`01-single-guided-session`)
- Promote the Guided session to a single book-level guide entry in Agent mode (distinct from multi-session free-form Q&A).
- Legacy books with multiple Guided sessions treat the most recently updated one as primary and keep older ones viewable under archived/legacy sessions.
- Support in-place chapter re-read (branching) and a low-frequency "Archive & start fresh" option in guide settings.

### 2. Guided Sliding Context & Reset (`02-guided-sliding-context`)
- New append-only Pi session entry `guide_window_cut` (modeled after `context_prune`) recording `firstKeptEntryId` and `reason` (`"batch" | "jump" | "manual"`).
- `contextBranch()` for Guided sessions projects: `[bookSnapshot, ...all earlier guideRecap entries, ...entries from firstKeptEntryId onward]`, with aggressive pruning of book-text tool results older than the latest step.
- **Batch advance**: when active window tokens exceed ~35k (coherence-leaning), advance `firstKeptEntryId` to the earliest turn that leaves the latest 2–3 guided steps in context, only dropping chapters whose `Chapter recap` is already recorded. Zero LLM calls; preserves Prompt Cache between advances.
- **Non-adjacent jump**: when a new step starts in a chapter with `|newChapter - prevChapter| > 1` (ignoring empty chapters), automatically record a `guide_window_cut` (`reason: "jump"`) right before the new step.
- **Manual reset & indicator**: compact context indicator in the guide header (showing loaded recaps + active window tokens) with a one-click "Collapse context (keep recaps)" action that writes a visible transcript divider (`guide_window_cut`, `reason: "manual"`).
- Generic Compaction stays as the safety net for unusually huge single chapters before recap generation.

### 3. Inline `guide_step` Text & Natural Breaks (`03-inline-guide-step-and-breaks`)
- `guide_step` directly fetches and returns the step's chapter text (within a safe inline size cap; multi-part oversized spans still instruct follow-up `read_chapter` calls for remaining parts), eliminating one full LLM round-trip on every Continue.
- Pruning clears the inline chapter body inside older `guide_step` tool results while preserving `entry.guide` metadata and a compact step-taken summary.
- `guideReadingState` includes nearby section headings around the default step end (compact heading list with block indices) so the model can actually stop at a natural section break without an extra `list_guide_blocks` turn.
- Smart default starting chapter: before the first step, default to the current open chapter or skip obvious front matter (cover/copyright/TOC-only pages) when starting from the beginning.

### 4. Inline Original Images in Guided Steps (`04-inline-step-images`)
- Extend `GuideBlock` (or a lightweight `stepImages` lookup on `BookContentPort`) to expose `{ src, alt, caption? }` for `kind: "image"` blocks while filtering out tiny decorative ornaments/rules.
- No base64 stored in session JSONL; step images are derived on the fly from `GuideSpan` and loaded at full crisp resolution via the EPUB worker into an LRU blob-URL cache.
- Render a compact **Step Image Strip** directly under `GuideStepMarker` for steps containing figures; clicking any image opens the existing `ImageViewer` (zoom, pan, keyboard shortcuts).
- When `guide_step` returns a step containing images: for vision-capable models, explicitly list their `src` and prompt calling `view_image` when explaining figures; for non-vision models, note that images cannot be viewed directly.

### 5. Page Margin Guide Cards (`05-book-pane-guide-card`)
- Extend `guidePageMarks` / `applyGuideMarks` to also set `data-litera-guide-step="<stepId>"` on marked paragraphs (attribute-only, zero DOM/CFI/layout impact).
- Avoid injecting absolute-positioned rails or dots inside Foliate's WebKit iframe DOM (known to spill into column gaps—see `.scratch/guided-reading-ranges/issues/05-book-pane-marks.md`).
- Trigger via two non-intrusive host-layer paths:
  1. **SelectionToolbar (desktop & mobile)**: selecting already-guided text replaces the "Guide up to here" (`selectionBefore`) error with **"View guide explanation"**.
  2. **Host-layer hover chip (desktop)**: hovering a marked paragraph surfaces a subtle host-positioned action chip near the paragraph rect (using iframe-to-viewport coordinate mapping like `FootnotePopup`) without altering iframe flow.
- Clicking opens a **Page Guide Card** (floating popover positioned like `FootnotePopup` on desktop; bottom sheet on mobile) showing:
  - Step label & read/skimmed badge;
  - The step's explanation (`MarkdownText`), auto-scrolled/highlighted if it cites the clicked paragraph;
  - Collapsible list of side questions asked during that step;
  - Actions: **"Open in guide"** (scrolls transcript to the step) and **"Ask about this passage"** (sends a side question with the paragraph context).

### 6. Humanities-Oriented Recaps & Book-Wide Recap Drawer (`06-recap-drawer-and-book-mindmap`)
- Refine `RECAP_PROMPT` and default guided style guidance for non-fiction/humanities depth:
  - Capture chapter thesis, argument chain, key author-specific concepts, and scholars/schools engaged or critiqued;
  - Explicitly distinguish substantive footnotes/translator notes (weave into explanation) from bare bibliographic citations (omit and note briefly at the end);
  - Keep author's claims clearly separated from historical/intellectual background added by the assistant.
- Add a unified **"Book Recaps" drawer** in the guide header:
  - Lists all recorded `Chapter recap` entries in book order (showing unread/skipped chapter gaps);
  - Supports jumping to the corresponding transcript step or Book chapter, regenerating a recap, exporting all recaps as clean Markdown, and a one-click **"Generate book argument mind map"** action that synthesizes all recaps into a `draw_mindmap` overview.

### 7. Guided Outline Rail & History Search (`07-guided-outline-and-history-search`)
- Adapt `ChatOutlineRail` in Guided sessions into a **Guide Timeline**: guided steps show their actual chapter/range label instead of repeated `"继续带读"`, `Chapter recap` entries render as distinct milestone ticks, and side questions appear as secondary ticks.
- Add `search_guide_history(queries)` tool so the model can search earlier guided explanations and user side questions that have slid out of the active context window when a later chapter echoes an earlier discussion.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Single canonical Guided session per Book | resolved | — |
| 02 | Guided sliding context window, jump clear, and manual reset | resolved | 01 |
| 03 | Inline `guide_step` chapter text and natural section-break hints | resolved | — |
| 04 | Inline original images in guided steps with `ImageViewer` and vision hints | resolved | 03 |
| 05 | Book pane guide cards (host overlay & already-read selection) | resolved | 01 |
| 06 | Humanities-oriented recaps, unified recap drawer, export, and book mind map | resolved | 01 |
| 07 | Guided `ChatOutlineRail` timeline and `search_guide_history` tool | resolved | 02 |

## User Stories

1. As a reader, I want one continuous guide per book whose model context stays lean (~35k tokens) via Chapter recap relay, so I never have to open a new session per chapter just to save tokens or avoid Compaction.
2. As a non-linear reader jumping from chapter 3 to chapter 10, I want the stale chapter 3 discussion cleared automatically while keeping all recorded recaps, so chapter 10 starts clean.
3. As a reader pressing Continue, I want `guide_step` to return the text immediately and stop at natural section breaks, so responses are faster and arguments are not cut mid-point.
4. As a reader of a book with diagrams or maps, I want the step's original images shown inline in the guide with click-to-zoom, so I do not have to hunt for them in the Book pane.
5. As a reader re-reading the Book pane, I want to click or select a guided paragraph to view the assistant's explanation and my past questions in a floating card, so the guide enriches direct reading too.
6. As a humanities/social-science reader, I want a single drawer holding all chapter recaps with Markdown export and one-click whole-book argument mind map, plus substantive footnotes woven into explanations.

## Out of Scope

- Spoiler-guarded Living Glossary / character & entity database (explicitly rejected in favor of Direction 1).
- Per-session style presets, configurable step-size presets, and speculative next-step prefetching (candidates for a later spec).
- TTS continuous podcast-style guided listening (candidate for a later spec).
- Syncing guided progress into Library `Reading status` / `FinishBookPrompt` (candidate for a later spec).
- Mid-chapter arbitrary starting points and "backfill recap for skipped chapters" (candidates for a later spec).
