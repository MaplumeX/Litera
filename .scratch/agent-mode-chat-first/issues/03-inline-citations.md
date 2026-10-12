# 03: Inline citations that expand in place

**Status:** resolved

**What to build:** When the assistant quotes the Book verbatim, it marks the quote as a citation. The quote renders inline with a small chapter badge. Once the answer has finished streaming, every citation is checked against the Book text and shown as verified, relocated (found in a different chapter than cited) or unverified. Clicking a citation opens a popover with the paragraph that contains the quote, its chapter title, and an "Open in Book" action that reveals the Book pane, jumps to the exact sentence and highlights it.

## Decisions

- **Marker format: a Markdown link with a `cite:` scheme.** `[“exact quoted text”](cite:12)`, where `12` is the chapterIndex. The link text is the quote. Chosen because models write Markdown links reliably, a half-streamed link stays plain text until it closes, and `AssistantMessage` already overrides the `a` component.
  - `react-markdown`'s default `urlTransform` blanks unknown schemes, so pass a `urlTransform` that keeps `cite:` and defers to `defaultUrlTransform` for everything else.
  - A malformed index (`cite:abc`) renders as an unverified citation, never as a link the webview would follow.
  - Plain-text copy keeps the quote and drops the marker (the copy button copies the message's raw text today; strip `(cite:N)` there).
- **When citations are required: only for verbatim quotes.** Paraphrase and interpretation are not cited. The rule goes in `SYSTEM_PROMPT`'s `<response>` section next to the existing "Quote only the minimum text needed" line, together with the format and "the quote must be copied exactly from text returned by read_chapter or search_in_book". Not in tool descriptions: it is a response-format rule.
- **Verification happens at render time and is not persisted.** No Session, Manifest or sync changes; historical and synced Sessions are re-verified when shown.
  - Runs once a message has finished streaming, never on partial text. Results are cached per (chapterIndex, quote) for the open Book.
  - Goes through a new runtime/book-worker call, `locateQuote(chapterIndex, quote)`, returning `{ status: "verified" | "relocated" | "unverified", chapterIndex, chapterTitle?, passage? }`.
  - Matching normalizes both sides: whitespace removed, full/half-width and curly/straight quotes unified, surrounding quote marks stripped. A quote containing an ellipsis (`…`, `……`, `...`) matches when its segments appear in order within one paragraph.
  - Search order: the cited chapter first, then the whole Book. A whole-Book hit is `relocated` and carries the real chapterIndex, which the badge and "Open in Book" use.
  - `passage` is the paragraph containing the match (from the chapter's Markdown, split on blank lines), capped around 600 characters centred on the match.
- **Popover content loads with verification.** The passage comes back with the verification result, so opening the popover needs no extra request.
- **"Open in Book" jumps to the sentence and highlights it.**
  - ReaderView gains `goToQuote(href, quote): Promise<boolean>`. It resolves the chapter's href to a foliate section index (`view.book.resolveHref`), runs `view.search({ query, index })` on that section, goes to the first result's CFI and leaves foliate's search outline as the highlight. The highlight is cleared on the next search or when the Book is closed.
  - The query is the longest ellipsis-free segment of the quote; on no match, retry with its first 20 characters.
  - If the section search still finds nothing, fall back to `goToTocItem(href)` for the chapter start.
  - In Agent mode with the Book pane collapsed, the pane is expanded first (and the layout persisted), and the jump runs after the pane is visible.
  - Chapter hrefs come from the runtime's TOC entries (`BookTocEntry.hrefs[0]` for the chapterIndex), so the UI needs a small runtime accessor for them, or `locateQuote` returns the href with its result.

## Rendering

- Inline: the quote text, followed by a superscript badge. Verified: neutral. Relocated: neutral, with the corrected chapter in the popover. Unverified: muted, dashed underline and a warning icon with an accessible label ("未在书中找到此引文"). While verification is pending, the badge shows no state.
- Popover (click or keyboard): chapter title, the passage with the quoted span emphasised, the status line, and the "在书中打开" button (hidden for unverified citations).
- Works in both reader modes. In reading mode the Book pane is always visible, so "Open in Book" only navigates.

## Acceptance

- [x] `SYSTEM_PROMPT` states the citation rule and format
- [x] `cite:` links survive `react-markdown` and render as citations; other links are unchanged
- [x] `locateQuote` returns verified / relocated / unverified correctly, including normalization and ellipsis segments (epub-content tests)
- [x] Verification runs only after streaming ends and is cached; unverified citations are visibly marked
- [x] Popover shows chapter title and passage with the quote emphasised
- [x] "Open in Book" expands a collapsed Agent-mode Book pane, jumps to the sentence and highlights it; it falls back to the chapter start when the sentence is not found
- [x] Copying a message strips the `(cite:N)` markers
- [x] Tests: epub-content tests for `locateQuote`; AssistantMessage tests for rendering states (verification mocked); an App-level test that "Open in Book" un-collapses the pane and calls `goToQuote` on the reader handle

## Out of scope

- Citations for paraphrases or interpretations
- Persisting verification results
- A citations index or "all sources" panel per Session

## Comments

- Implemented. Book side: `locateQuote` in `epub-content.ts`, exposed through the worker, `BookContentPort` and `LiteraAgentRuntime.locateQuote`. UI side: `Citation.tsx` (inline trigger + popover), `lib/citations.ts` (marker parsing, copy stripping, search queries), `ReaderView.goToQuote`, and `App.handleOpenQuote`.
- The cache lives in `ChatPanel` and is keyed by bookId, chapterIndex and quote; failed checks are evicted so they retry.
- Not yet checked in the real app: whether foliate's section search finds quotes that the worker verified (different text normalization), and how reliably real models follow the citation format. Both need a pass with real books and providers.
