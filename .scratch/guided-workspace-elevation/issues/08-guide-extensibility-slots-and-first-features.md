# 08: Guide extensibility contracts & first plug-in features (save note, export)

**Status:** resolved

**Blocked by:** 06, 07

**What to build:** Define clean, documented extension points across `GuideDocument`, `GuideController`, and `GuideWorkspace` so future guided capabilities (style/pace presets, guided TTS, speculative prefetch, interactive widgets) plug in cleanly—and validate the architecture by shipping two high-value, low-risk plug-in features: **"Save explanation to Book Note"** and **"Export Guided Companion Markdown"**.

## Scope & Tasks

- [ ] Define three core extensibility contracts:
  1. **Structured `GuideStepOptions` pipeline** (`src/agent/runtime/guide-controller.ts` & `guide.ts`):
     - Extend `GuideController.takeStep(span, options?: GuideStepOptions)` with first-class optional parameters (`pace?: "standard" | "compact" | "deep"`, `styleOverride?: string`) injected cleanly into the turn's instruction context rather than ad-hoc string concatenation in UI components.
     - Persisted step metadata stays backward compatible with existing `GuideStep` JSONL records.
  2. **Step Action Slot API** (`src/components/guide/GuideStepSection.tsx`):
     - Standardize a compact action registry/slot (`GuideStepAction[]`) on `GuideStepSection` receiving `(stepNode, guideDocument, actions)` so per-step actions (regenerate, switch angle/branch, copy, save to annotations, future TTS play-from-step) register declaratively without bloating `GuideStepSection`.
  3. **Pure Prose Stream Selector** (`src/lib/guide-document.ts`):
     - Export `extractGuideProseSegments(document: GuideDocument)` returning ordered `{ stepIndex, chapterIndex, chapterTitle, label, plainText, markdown }[]` (stripping tool cards and separating side Q&As), providing a ready-made contract for both export and future podcast-style Guided TTS playback.
- [ ] Ship Plug-in Feature #1 — **Save step explanation / excerpt to Book Annotations**:
  - Add a "Save as note" action in `GuideStepSection`'s action slot that anchors to the step's opening passage/CFI in the Book (or saves an annotation linked to the chapter/step) via the existing Annotations pipeline, with clear confirmation toast/feedback.
- [ ] Ship Plug-in Feature #2 — **Export Guided Companion Notes (Markdown)**:
  - Add an "Export guide (Markdown)" action in `GuideNavRail` (desktop) and Guide settings menu (mobile), powered by `extractGuideProseSegments()` + existing Tauri export helper (`src-tauri/src/export.rs`):
    - Exports Book title, chapter headings, step labels, retelling prose (converting internal `cite:N` links to clean readable quotes), and optionally includes anchored side Q&As as blockquoted sub-sections.
- [ ] Tests:
  - Unit tests for `extractGuideProseSegments()`, Markdown export formatting (with/without side Q&As, citation link cleanup), `GuideStepOptions` prompt injection, and `GuideStepSection` custom action slot rendering.

## Acceptance Criteria

- Adding a new per-step capability or document-level consumer requires zero edits to `ChatWorkspace`, `ChatController`, or `pi-session.ts`.
- Both reference plug-in features ("Save as note" and "Export guide as Markdown") work end-to-end and have full unit test coverage.

## Comments
