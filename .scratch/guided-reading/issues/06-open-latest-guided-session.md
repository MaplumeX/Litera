# 06: Open the latest Guided session by default

**Status:** resolved

**What to build:** Opening a book in Agent mode selects the most recently updated Guided session if the book has one; otherwise the current behaviour is kept. Reading mode is unaffected.

- [x] Selection rule applied on book open in Agent mode only
- [x] Tests: book with and without Guided sessions

## Comments

- `preferGuidedSession` on ChatPanel: desktop passes `readerMode === "agent"`, mobile passes it when the assistant sheet is full (the mobile Agent mode).
