# Spec: Answer process timeline — tool calls and thinking for a reader

Status: resolved

## Problem Statement

An assistant answer interleaves thinking, Book tool calls and text (`thinking → read_chapter → thinking → search_in_book → thinking → text`). After the chat-first Agent mode work, Book tool calls fold into one source summary, but the rest still renders the way a coding agent does:

- Every thinking block is its own "思考过程" row, detached from the lookup it reasons about.
- Expanding the source summary shows raw tool cards: tool ids, `chapterIndex: 3`, JSON results in monospace.
- Narration before a tool call ("我先看一下目录") renders as a full answer text block with a copy button.
- While streaming, the reader only sees typing dots and a generic "正在查阅书籍…".

## Solution

Every assistant answer has two layers: the **process** and the **answer**.

- **Split rule.** Thinking blocks and Book tool calls are process. Text before the last Book tool call is narration and is also process. Text after it, and mind maps anywhere, are the answer.
- **One process row** sits above the answer. Collapsed it shows the source summary on a single line whatever the answer read: one chapter by name with its coverage, several as "{first} 等 N 个章节" plus one "K 个章节未读完" count, then searches and failures. The full chapter list is in the timeline and the line's tooltip; with no Book tool calls it shows "思考过程". While streaming it shows the current activity instead: "正在阅读第三章…", "正在搜索「…」…", "正在思考…", with the tail of the live thinking under it.
- **Expanded, it is a timeline** in call order. Thinking and narration show as muted prose clamped to two lines. Each tool call shows as one row in reader language:
  - `read_chapter`: "阅读 {chapter}" with its part coverage. Consecutive reads of one chapter merge into one row. Details: an excerpt and 在书中打开.
  - `search_in_book`: the queries and hit count. Details: the hits (chapter + snippet), each with 在书中打开.
  - `get_toc` / `get_book_metadata` / `list_annotations`: one line.
  - Failures: marked failed, with the error text as details.
  - Unknown tools: the tool name and a parameter summary.
- **Raw data stays reachable** through a small per-step `{}` toggle that reveals the old parameter/result view.
- Copy and regenerate attach only to answer text.

## Decisions

- A derived view: nothing new is persisted, no Session, Manifest or sync changes.
- No thinking duration (no timestamps on blocks; not worth a persisted field).
- No "cited by the answer" marks on timeline steps.
- 在书中打开 locates a short anchor from the excerpt or snippet with the existing Citation `locate`, then reuses `openInBook`.
