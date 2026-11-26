# 06: Humanities-oriented recaps, unified recap drawer, export, and book mind map

**Status:** resolved

**Blocked by:** 01

**What to build:** Tailor guided explanations and `Chapter recap` for humanities/social-science reading, and surface all recaps in a unified book-wide drawer with Markdown export and one-click whole-book argument mind map generation.

- [x] Humanities-oriented prompt & recap refinements (`src/agent/runtime/guide.ts`, `src/agent/runtime/recap.ts`):
  - Refine `RECAP_PROMPT` so each chapter recap concisely captures: chapter's role/thesis in the book, core argument chain, key author-specific concepts/definitions, and scholars/schools engaged or critiqued (keeping concise word/char bounds)
  - Refine `DEFAULT_GUIDED_STYLE` to explicitly cover substantive footnotes/translator notes inline (skipping bare bibliographic citations and noting them briefly at the end) and clearly separate the author's claims from historical/intellectual background added by the assistant
- [x] Unified **"Book Recaps" drawer** (accessible from the Guided session header on desktop and mobile):
  - Displays all recorded `Chapter recap` entries in TOC order, also visually indicating chapters that are unread, in-progress, or skipped
  - Per-recap actions: expand/collapse `MarkdownText`, jump to the corresponding transcript step or Book chapter, and **Regenerate recap**
  - **Export Markdown**: export all recaps (optionally with book title, author, chapter headings, and cited quotes) as a clean `.md` file
  - **Whole-book argument mind map**: one-click action that synthesizes all recorded recaps into a visual argument outline using the existing `draw_mindmap` / `MindmapCard` pipeline
- [x] Tests: `recap.test.ts` / `guide.test.ts`, drawer component tests (ordering, gap display, export formatting, regenerate trigger)

## Comments

- Decision updated after testing: `Chapter recap` is kept as a silent, model-only background memory mechanism (like `Pruning`), rather than exposed in a user-facing drawer or transcript marker. The humanities-oriented `RECAP_PROMPT` and substantive-footnote guidance in `DEFAULT_GUIDED_STYLE` stay active.
