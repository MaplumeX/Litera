# 07: Guided `ChatOutlineRail` timeline and `search_guide_history` tool

**Status:** resolved

**Blocked by:** 02

**What to build:** Make long continuous Guided transcripts effortless to navigate for the reader (`ChatOutlineRail`) and searchable for the model (`search_guide_history`) once earlier chapters slide out of the active context window.

- [x] Guided **Outline Rail** (`src/components/chat/ChatOutlineRail.tsx`, `src/components/chat/ChatPanel.tsx`):
  - In Guided sessions, derive outline items from actual taken guided steps (showing chapter/range label instead of repeated `"继续带读"`), `Chapter recap` milestones (distinct emphasized tick), and user side questions (secondary shorter tick)
  - Hover preview shows the step's chapter/range label, recap heading, or side question preview; clicking smoothly scrolls to the exact marker/message
- [x] **`search_guide_history(queries)` tool** (`src/agent/runtime/embedded-runtime.ts`):
  - Guided-session-only read-only tool searching the full active branch's earlier assistant explanations, `Chapter recap` entries, and user side questions (excluding raw book-text tool results)
  - Returns top matching snippets with chapter/step metadata so the model can recall earlier discussions or analogies that have slid out of the active window when a later chapter connects back to them
  - Briefly mention `search_guide_history` in `guidedPrompt` (use when recaps are too brief and an earlier discussion detail is needed)
- [x] Tests: `ChatOutlineRail.test.tsx` (step/recap/side-question ticks & previews), `embedded-runtime.guided.test.ts` (`search_guide_history` hits from slid-out turns)

## Comments
