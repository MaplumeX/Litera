# 05: Book pane guide cards (host overlay & already-read selection)

**Status:** resolved

**Blocked by:** 01

**What to build:** Let readers inspect the canonical Guide's explanation (and any side questions) for any already-guided paragraph right inside the Book pane, without disturbing Foliate pagination or column gaps.

- [x] Paragraph-to-step mapping:
  - Extend `GuidePageMarkChapter` / `GuideFileMarks` and `applyGuideMarks` (`src/lib/guide-marks.ts`) to record `data-litera-guide-step="<stepId>"` on each marked paragraph (attribute-only; zero text/DOM/CFI mutation)
  - Build a fast lookup from `stepId` to the step's explanation message, label, skim flag, and subsequent side Q&As before the next step
- [x] Non-intrusive triggers (strictly host-layer, never injecting positioned rails/dots inside Foliate's iframe DOM):
  - **Already-read selection (desktop & mobile)**: when a reader selects text inside an already-guided paragraph, replace the `selectionBefore` error path in `SelectionToolbar` with a **"View guide explanation"** action that opens the card for that paragraph's step
  - **Desktop hover chip**: hovering a paragraph with `data-litera-guide-step` shows a subtle host-layer floating chip positioned via iframe-to-viewport rect mapping (same coordinate bridge as `FootnotePopup`), keeping normal clicks and page turns untouched
- [x] **Page Guide Card** UI:
  - Desktop: floating popover anchored near the paragraph (reusing `FootnotePopup` viewport-clamping and Esc/outside-click handling)
  - Mobile: bottom sheet (`MobileSheet`)
  - Shows step range & read/skimmed badge, full explanation rendered with `MarkdownText` (auto-scrolling/highlighting if the explanation cites text from the clicked paragraph), collapsible list of side Q&As from that step, and two footer actions: **"Open in guide"** (reveals/scrolls transcript to that step) and **"Ask about this passage"** (prefills side question without advancing the Guide cursor)
- [x] Works in both Reading mode and Agent mode (loads the Book's canonical Guided session steps/explanations lazily when needed)
- [x] Tests: `guide-marks.test.ts` (step attribute tagging & clearing), `SelectionToolbar.test.tsx`, `ReaderView.test.tsx` / card rendering tests

## Comments
