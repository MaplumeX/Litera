# 01: Agent mode — Book pane hidden by default

**Status:** resolved

**What to build:** In Agent mode the Session fills the window by default. The Book pane is still available from the existing show/hide button, but a book opened in Agent mode with no saved layout starts with the Book pane collapsed.

- [x] A book with no `lastLayout` opened in Agent mode (via `lastReaderMode` or the 默认阅读模式 setting) starts with `bookCollapsed: true`
- [x] Switching a book into Agent mode for the first time (no saved layout) collapses the Book pane
- [x] A saved `lastLayout.bookCollapsed` is respected in both directions
- [x] Reading mode is unaffected (`DEFAULT_READER_LAYOUT` for reading mode keeps the chat collapsed, book shown)
- [x] The runtime still receives `book_ready` and the TOC with the pane hidden (ReaderView stays mounted)
- [x] Tests: `reader-layout.test.ts` for the mode-aware default; an App-level test that Agent mode with no saved layout renders the Book cell hidden

**Notes:** The default currently lives in `src/lib/reader-layout.ts` (`DEFAULT_READER_LAYOUT`) and is mode-agnostic; it needs to take the reader mode into account.
