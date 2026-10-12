# Spec: Chat-first Agent mode — the Book as a retrieval source

Status: resolved

## Problem Statement

Agent mode (the reader mode the user switches to with the Bot button, or picks as 默认阅读模式 in settings) is today the reading-mode layout with the two cells swapped: the Session takes the main cell and the Book renderer sits in a 22–60% side pane. Nothing else changes.

That layout assumes the reader still reads the Book alongside the conversation. In practice a reader in Agent mode reads the assistant's messages, not the Book. The Book acts like a RAG corpus: the assistant retrieves from it, the reader consumes the answer, and the table of contents is the only part of the Book the reader looks at directly.

Two problems follow:

1. **The layout fights the use.** The Book pane takes width the reader does not want. Hiding it breaks things: the TOC drawer lives inside the Book pane and force-reopens it, and the chapter context sent with a prompt is the Book pane's last page position, which goes stale once the pane is hidden.
2. **Hiding the Book makes it a black box.** Once the reader stops looking at the text, they cannot tell what the assistant actually read, what it skipped, or whether a quoted passage exists. Today the only provenance is the raw tool-call cards.

## Solution

Make Agent mode chat-first and make the Book's role as a source **auditable inside the conversation**, the way NotebookLM or Perplexity treat their sources:

- The Session fills the screen by default; the Book renderer is an optional pane, not a default cell. Reading the Book itself is what reading mode is for.
- Every assistant message shows a compact **source summary**: which chapters/parts it read, which searches it ran, and a warning when coverage of a chapter was partial.
- Quotes and claims carry **inline citations** that expand in place into the original passage with its chapter and surrounding text. Opening the passage in the Book is a secondary action.
- The TOC becomes a **scope panel** next to the Session: picking a chapter sets the discussion scope for the next prompts, independent of the Book pane's page position.
- Retrieval quality matters more once the reader never sees the text, so whole-chapter reading gets cheaper.

Reading mode is unchanged.

## User Stories

1. As a reader in Agent mode, I want the conversation to use the full window by default, so that the assistant's messages are the main content.
2. As a reader in Agent mode, I want to open the Book pane only when I choose to, so that it is available but out of the way.
3. As a reader, I want each answer to state which chapters and parts the assistant read, so that I know what the answer is based on.
4. As a reader, I want to be warned when the assistant read only part of a chapter it is explaining, so that I do not mistake a partial reading for a full one.
5. As a reader, I want quoted passages to be clickable and expand into the original text in place, so that I can verify them without leaving the conversation.
6. As a reader, I want a citation whose quote cannot be found in the Book to be marked as unverified, so that fabricated quotes are visible.
7. As a reader, I want to open the TOC without the Book pane opening, so that I can navigate by structure alone.
8. As a reader, I want to pick a chapter from the TOC as the discussion scope, so that "explain this chapter" refers to what I picked, not to a stale page position.
9. As a reader, I want the current scope shown above the input, so that I always know which chapter my next prompt is about.
10. As a reader, I want the assistant to read a whole chapter when it explains one, so that explanations do not silently cover only the first window.

## Implementation Decisions

- **Mode boundary.** Everything here applies to Agent mode only (`readerMode === "agent"`). Reading mode's layout, TOC drawer and chat dock are unchanged.
- **Book pane default.** In Agent mode the Book pane starts collapsed for books with no saved layout. A saved `lastLayout.bookCollapsed` still wins. The ReaderView stays mounted while hidden (it already is), so the runtime's book worker and TOC are unaffected.
- **Source summary is a derived view.** It is computed from the assistant turn's existing `read_chapter` / `search_in_book` tool calls and results (part, totalParts, hit counts). No new persisted entity, no Session, Manifest or sync changes, mirroring how Mind Maps are derived from tool-call entries.
- **Scope reuses `chapterHref`.** The prompt context already carries `chapterHref`, which `chapterAside` resolves to a chapterIndex. A scope picked from the TOC overrides the Book pane's `currentChapterHref` for prompts; no runtime API change.
- **Citations** are `[quote](cite:chapterIndex)` Markdown links, verified against the Book text at render time and never persisted (see issue 03).
- **Whole-chapter reading** reuses `read_chapter`: the snapshot reports each chapter's part count so the model can request every part in one turn (issue 05). Semantic search (issue 06) was dropped.

## Issues

| # | Title | Status | Blocked by |
|---|---|---|---|
| 01 | Agent mode: Book pane hidden by default | resolved | — |
| 02 | Per-answer source summary | resolved | — |
| 03 | Inline citations that expand in place | resolved | — |
| 04 | TOC as a scope panel in Agent mode | resolved | — |
| 05 | Whole-chapter reading | resolved | — |
| 06 | Semantic search over the Book | wontfix | — |

All issues are closed: 01–05 resolved, 06 dropped.

## Out of Scope

- Any change to reading mode.
- Removing the Book pane from Agent mode entirely.
- Semantic (embedding) search.
- Per-book memory or a cross-Session chapter summary cache (possible follow-up; would add a persisted entity).
- Prompt presets or teaching templates for chapter explanations.
- Reading progress / Reading status semantics while the Book pane is hidden.

## Further Notes

- Design came out of a discussion that rejected two alternatives: hiding the Book with no provenance (black box), and making the Book pane follow the conversation (pulls the reader back into the text, against the use case).
- The black-box concern is answered by provenance in the conversation, not by showing the Book.
