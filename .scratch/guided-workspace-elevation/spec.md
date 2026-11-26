# Spec: Guided workspace elevation — Book-scoped GuideDocument, GuideWorkspace, three-mode shell, and GuideController

Status: resolved

## Problem Statement

Despite the recent `guided-reading-redesign` improvements (single canonical Guided session, sliding context with silent Chapter recaps, inline `guide_step`, inline images, and `PageGuideCard`), Guided reading still behaves structurally and experientially as an attachment to the general Agent chat interface:

1. **Navigation & layout coupling.** `ReaderMode` (`src/lib/reader-mode.ts`) only has `"reader" | "agent"`. The Book's canonical Guided session lives inside `SessionList` alongside free-form multi-session Q&A, inherits the session-list sidebar it no longer needs, and squeezes all guided controls (`GuideBar`) into a narrow strip above the chat textarea.
2. **Chat-stream UX mismatch.** `ChatPanel.tsx` (~1150 lines) interleaves a dozen `isGuided` branches into a generic Q&A transcript. Pressing Continue inserts mechanical user bubbles, and reader side questions break up the continuous chapter retelling on the same flat timeline.
3. **Session-bound state instead of Book-bound state.** `guideSteps`, `guideCards`, `guideMarks`, and TOC `guideProgress` are derived inside `ChatPanel` from the *currently selected* session and pushed upward to `App.tsx` / `MobileReaderPage.tsx`. Switching to an ordinary Q&A session wipes guide marks, TOC progress, and `PageGuideCard` from the Book pane.
4. **Monolithic runtime coupling.** `embedded-runtime.ts` and `use-agent-bridge.ts` mix general chat operations with a dozen `guide*` methods. Every new guided feature (per-step style/pace controls, guided TTS, speculative prefetch, exporting guided notes, saving explanations to Annotations) must cut across `pi-session`, `embedded-runtime`, `use-agent-bridge`, `ChatPanel`, and both desktop/mobile shells.

## Core Decisions

1. **Keep Pi Session JSONL as the single persistence truth (zero migration, zero Sync break).**
   Do not introduce a second persisted storage format for Guided reading. Pi Session JSONL already powers S3 Sync, branching, sliding context (`guide_window_cut`), and silent `Chapter recap` entries. Treat it as the event-sourced write log and build a pure, Book-scoped read model (`GuideDocument`) on top of it.
2. **Elevate Guided reading to a Book-scoped `GuideDocument` read model.**
   Unify all guided derivations (`takenGuideSteps`, `extractGuideStepCards`, guided outline items, TOC progress, Book-pane marks, chapter grouping, and anchored side-threads) into one deterministic projection bound to the Book's canonical Guided session. `ReaderView`, `TocSidebar`, and `PageGuideCard` subscribe to this Book-scoped model directly—remaining active even when the user opens an ordinary Q&A Session.
3. **Adopt a Document-First UX in a dedicated `GuideWorkspace`.**
   Separate `ChatPanel` into shared assistant primitives + `ChatWorkspace` (pure free-form Q&A) + `GuideWorkspace` (companion-book layout). In `GuideWorkspace`, hide mechanical `guideRequest` user bubbles, render each `Guided step` as a structured `GuideStepSection` grouped by Book chapter, anchor follow-up side Q&As under their parent step as collapsible `GuideSideThread`s, and promote reading progression (`GuideControlDock`) over the chat box.
4. **Elevate top-level `ReaderMode` to three states: `"reader" | "guide" | "agent"`.**
   Give Guided reading its own first-class workspace, header controls, and left navigation rail (`GuideNavRail`: chapter progress tree + side-question index + guide settings), freeing `Agent` mode to be a clean multi-session research/Q&A workspace. Keep legacy/archived Guided sessions readable without data loss. Update both desktop (`App.tsx`) and Android (`MobileReaderPage.tsx` / `AssistantSheet.tsx`).
5. **Preserve the silent `Chapter recap` decision.**
   Per `CONTEXT.md` and `.scratch/guided-reading-redesign/issues/06-recap-drawer-and-book-mindmap.md`, `Chapter recap` remains a silent, model-only background memory mechanism and is **not** surfaced as a user-facing drawer or transcript clutter.
6. **Split `GuideController` out of `embedded-runtime.ts` and define clean extension slots.**
   Extract a shared `AgentTurnRunner` and a dedicated `GuideController` + `useGuideBridge`, then expose clean extension contracts (step action slots, structured `StepOptions`, and pure prose stream selectors) so future features (pace/style presets, guided TTS, speculative prefetch, export, save-to-annotation) plug in without touching general chat code.

## Architecture Overview

```text
                       ┌──────────────────────┐
                       │   Pi Session JSONL   │  (Write truth: Sync, branches, recaps, cuts)
                       └──────────┬───────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │   ChatController   │            │  GuideController   │  (Book-scoped canonical Guide)
      │  (Multi-session)   │            │ (Steps/Window/Opts)│
      └─────────┬──────────┘            └─────────┬──────────┘
                │                                 │ projectGuideDocument()
                ▼                                 ▼
      ┌────────────────────┐            ┌────────────────────┐
      │   ChatWorkspace    │            │   GuideDocument    │  (Single read model)
      └────────────────────┘            └─────────┬──────────┘
                ▲                                 │
                │ Shared primitives               ├─► GuideWorkspace (Document-first UI)
                │ (src/components/assistant/)     ├─► GuideNavRail   (Chapter progress & Q&A index)
                                                  ├─► ReaderView     (Always-on marks & PageGuideCard)
                                                  └─► TocSidebar     (Always-on TOC progress)
```

## Rollout Plan (Phases 1–4)

| Phase | Goal | Issues |
|---|---|---|
| **Phase 1: Data & State Decoupling** | Establish Book-scoped `GuideDocument` projection so Book pane and TOC never depend on ChatPanel's active session. | `01`, `02` |
| **Phase 2: UI Decomposition & Document-First UX** | Extract shared assistant primitives and build `GuideWorkspace` with chapter groups, step sections, and anchored side-threads. | `03`, `04` |
| **Phase 3: Three-Mode Shell & Dual-Platform UX** | Promote `ReaderMode` to `reader \| guide \| agent` (TS + Rust), add `GuideNavRail`, and adapt the Android sheet/shell. | `05`, `06` |
| **Phase 4: Runtime Split & Extensibility Foundation** | Extract `AgentTurnRunner` + `GuideController` + `useGuideBridge`, and land standard extension contracts + first plug-in features. | `07`, `08` |

## Issues

| # | Title | Phase | Status | Blocked by |
|---|---|---|---|---|
| 01 | `GuideDocument` pure projection model | Phase 1 | ready-for-agent | — |
| 02 | Book-scoped canonical Guide state (`useGuideDocument`) | Phase 1 | ready-for-agent | 01 |
| 03 | Shared assistant primitives & `ChatWorkspace` extraction | Phase 2 | ready-for-agent | — |
| 04 | `GuideWorkspace` document-first flow & anchored side-threads | Phase 2 | ready-for-agent | 01, 02, 03 |
| 05 | Three-mode `ReaderMode` (`reader \| guide \| agent`) & persistence | Phase 3 | ready-for-agent | 04 |
| 06 | `GuideNavRail` (desktop) & mobile shell adaptation | Phase 3 | ready-for-agent | 05 |
| 07 | Extract `AgentTurnRunner`, `GuideController`, and `useGuideBridge` | Phase 4 | ready-for-agent | 02, 04 |
| 08 | Guide extensibility contracts & first plug-in features (save note, export) | Phase 4 | ready-for-agent | 06, 07 |

## Compatibility & Invariants

- **Zero JSONL migration:** All existing Guided sessions (including legacy `message.guide` steps, `LegacyGuideStep` part-based steps, and archived multi-guided sessions) must project cleanly into `GuideDocument`.
- **S3 Sync unaffected:** `lastReaderMode` and `lastLayout` are local per-book state and are not part of the Sync `Manifest`. Pi Session JSONL schemas remain backward compatible.
- **Independent Guide cursor & Book reading position:** Preserves `CONTEXT.md` invariant—guiding never turns the Book's pages, and turning pages never moves the Guide cursor.
- **Sitting & Reading log tracking:** Time continues to count identically across `reader`, `guide`, and `agent` modes.

## Out of Scope (Enabled Next by This Foundation)

- Continuous podcast-style Guided TTS playback and auto-advance (enabled by `08`'s pure prose selector).
- Speculative next-step background prefetching (enabled by `07`'s `GuideController` state machine).
- Interactive step widgets (quizzes, bilingual split view, concept cards) and Library-card guided progress / `FinishBookPrompt` sync.
