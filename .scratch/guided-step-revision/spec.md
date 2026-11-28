# Spec: Chapter-scoped Step Revision, Tip Recovery, Intentful Re-explain & Chapter Actions for Guided Reading

Status: resolved

## Problem Statement

With `GuideWorkspace` presenting a `Guided session` as a chapter-separated companion book (one `GuideChapterRun` per view) and follow-up questions isolated on chapter-scoped off-spine `sideThread`s, Guided step retry/regeneration still relies on the traditional linear chat tree model (`session.leafId = target.id` + global `< 1/2 >` `BranchSwitcher`):

1. **Silent destructive timeline truncation.** Clicking "重新讲解" (`RefreshCw`) on a `Guided step` inside a historical chapter (e.g., Chapter 2 while `Guide cursor` sits at Chapter 6) calls `handleRegenerate` → `embedded-runtime.ts:regenerate`, rewinding `session.leafId` to Chapter 2 and instantly hiding Chapters 3–6, their TOC progress, Book-pane marks, and `Chapter recap`s. Because chapters render one per screen, the reader cannot even see that later chapters vanished.
2. **Misleading `< 1/2 >` branch semantics.** Inside a single-chapter view, `< 1/2 >` on a step looks like a local version toggle for that section, when it actually switches the entire downstream book timeline.
3. **Side-thread anchor & span fragility.** Falling back to `editPrompt` when `guideRequest` changes creates a new user entry ID, risking detaching a chapter's `sideThread` anchored to `run.anchorEntryId`. Re-running an unpinned `{}` ("继续带读") request also lets the model pick a different paragraph boundary than the original step.
4. **Blind "roll-the-dice" retries.** The bare `RefreshCw` icon offers no way to specify *why* the reader wants a re-explanation (more concise / deeper / different model / a one-line steering instruction). The bottom `GuideControlDock` `pace` selector does not even apply on retry, and `GuideStepOptions.styleOverride` has no retry entry point.
5. **Chat-style failure residue & missing chapter-level controls.** `GuideIncompleteStepCard` renders `< 1/2 >` branch switchers and can linger between steps; `GuideWorkspace` still carries a leftover bottom `RefreshCw` button; and there is no chapter-level menu separating non-destructive chapter re-reading from explicit destructive timeline rollback.

## Core Decisions

Replace the single global spine-rewind retry with **four orthogonal, non-interfering mechanisms**, preserving zero JSONL migration and full S3 `Sync` compatibility:

### 1. In-Place Step Revision (`stepRevision` — Off-Spine, Zero Spine Rewind)
- Re-explaining **any committed `Guided step`** (historical chapter or earlier step in the current chapter, and optionally the latest step when keeping the same span) runs **off-spine** without moving `session.leafId` or `Guide cursor`.
- **Pinned span:** The runtime locks the exact recorded `from..to` block range of the target `Guided step` (`node.step`) and supplies that source text directly—the model re-explains the same passage without re-deciding boundaries or calling `guide_step`.
- **Spoiler-free historical context:** Context projection mirrors `sideThreadContextEntries`: take `contextBranch(spine[0 .. before(targetStep)])` (preserving `bookSnapshot` and all prior `Chapter recap`s, excluding later steps/chapters), substituting any active revisions on earlier steps in that prefix.
- **Zero-migration JSONL storage:** Revision entries are persisted in the same Pi Session JSONL tagged with a top-level `stepRevision: { targetAnchorId, revisionId, pace?, styleOverride?, modelId? }`, rooted at `targetAnchorId`. Rust `pi_sessions.rs` generalizes `is_side_thread_entry` to `is_off_spine_entry` (`sideThread || stepRevision`) so `.leaf` is never overwritten and S3 `Sync` unions entries cleanly by ID.
- **Local semantic version switcher:** `GuideDocument` aggregates the original spine explanation (`v1 · 原版`) plus all `stepRevision`s for a step into `step.revisions[]`, exposing the active revision as `step.explanation` / `step.blocks`. Switching versions affects **only that step** (plus downstream consumers: `PageGuideCard`, Markdown export, Save-to-Note, search, and chapter `sideThread` context).
- **Chapter recap sync:** When revising a step in a chapter that already has a `Chapter recap` on the spine, silently refresh an updated `Chapter recap` in the background (or mark dirty and refresh) so future spine steps see accurate long-term memory.

### 2. Tip Recovery & Step Undo (Tail-Only Spine Operations)
- **Uncommitted tail attempt (`error` / `aborted` / `replied` without `guide_step`):** Render at the bottom of the active chapter as a compact **Tip Recovery Bar** (`重试` / `换模型重试` / `放弃`), with no `< 1/2 >` branch switcher. Retrying suppresses empty failed attempts cleanly; dismissing rewinds `session.leafId` back to the last committed step so dead failure cards do not clog the transcript. Hide empty historical incomplete cards between steps and remove the leftover bare `RefreshCw` button at the bottom of `GuideWorkspace`.
- **Latest committed step undo:** Exclusively on the spine's **furthest/latest step** (`step.isLatestStep`), expose **「撤销这一步」** (Undo & re-pick range), which rewinds `session.leafId` one turn back to before that step so `GuideBar` / `GuideRangePicker` can pick a shorter or longer span. Unavailable on non-tip steps.

### 3. Intentful Re-explain Controls (Unified Interaction Layer)
- Upgrade `GuideStepSection`'s bare `RefreshCw` button into a lightweight **Re-explain Popover** feeding Mechanisms 1 & 2:
  - **1-click default:** `原样重新讲解` (same settings).
  - **Depth quick-pills (`pace`):** `精简` (`compact`) / `标准` (`standard`) / `深入` (`deep`), highlighting the current version's pace.
  - **Model override (optional):** Switch to another configured model for this step's revision without permanently changing the global default (or clearly applying the chosen model for this revision).
  - **One-line instruction (`styleOverride`):** Inline text input (e.g. "多举例子", "逐句拆解论证"), submitted on Enter without cluttering the prose or `sideThread`.
- **Readable version labels:** Every revision carries its intent metadata, rendering semantic pills/items (`原版`, `深入`, `精简 · Claude Sonnet`, `“多举例子”`) instead of opaque `1/2` counters.

### 4. Chapter-Level Redo & Explicit Rollback
- Add a quiet `···` chapter action menu in `GuideChapterBar` (and/or `GuideChapterGroup` header) separating whole-chapter intents:
  - **Non-destructive 「重读本章」 (Re-read chapter):** Starts a new pass over the chapter (upgrading existing `reguideChapter`, optionally with chosen `pace` / `styleOverride`) without losing later chapters. In `GuideChapterBar`, fold repeated runs of the same chapter under one chapter entry with a pass switcher (`第 3 章 · 第 2 遍 ▾`) rather than listing duplicate flat rows.
  - **Explicit destructive 「从本章重新继续」 (Rollback to chapter):** The **only** historical spine-rewind entry point in Guide UI. Requires a confirmation dialog explicitly stating how many subsequent chapters will be hidden from the active spine (while preserving them in the JSONL branch tree).

## Architecture Overview

```text
Guided Spine (session.leafId stays on latest committed step)
  Ch1(s1) ─► recap(Ch1) ─► Ch2(s1) ───────► Ch2(s2) ─► recap(Ch2) ─► Ch3(s1) [leafId]
                              │   │                                      │
         stepRevision         │   │ sideThread                           │ sideThread
         {target: ch2_s1}     ▼   ▼ {anchorId: ch2_s1}                   ▼ {anchorId: ch3_s1}
                         v2(深入)  Q1 ─► A1                           Q1 ─► A1
                         v3(Sonnet)

Context Projections:
  1. Step Revision for Ch2(s1):
     contextBranch(spine[0 .. before(Ch2_s1)], activeRevisions) + pinnedSpan(Ch2_s1) + intent(pace/style)
  2. Chapter Side-Thread for Ch2:
     contextBranch(spine[0 .. endOf(Ch2)], activeRevisions) + sideThread(Ch2)[Q1, A1, ...]
  3. Spine Continue (Ch3_s2):
     contextBranch(spine[0 .. leafId], activeRevisions)  // includes refreshed recaps, zero side-thread noise
```

## Rollout Plan

| Phase | Goal | Issues |
|---|---|---|
| **Phase 1: Off-Spine Storage & Session Tree** | Generalize off-spine entry handling in Rust (`pi_sessions.rs`) and add `stepRevision` decoding, snapshot aggregation, and context projection in TS (`pi-session.ts`). | `01` |
| **Phase 2: Runtime, Controller & State Bridge** | Implement `reviseStep`, `selectStepRevision`, `undoLatestStep`, `dismissIncompleteTip`, `rollbackToChapterRun`, streaming revision events, and background `Chapter recap` refresh. | `02` |
| **Phase 3: `GuideDocument`, Export & Tip Recovery UI** | Project per-step `revisions[]` / `isLatestStep` into `GuideDocument`, replace chat-style `GuideIncompleteStepCard` with compact Tip Recovery Bar, wire latest-step undo, and remove legacy bottom retry button. | `03` |
| **Phase 4: Intentful Re-explain Popover & Version Switcher** | Build `GuideStepReexplainPopover` (`pace`, model override, `styleOverride`), semantic per-step version switcher, and keep `GuideWorkspace` anchored in the viewed chapter during revision. | `04` |
| **Phase 5: Chapter-Level Redo & Explicit Rollback** | Add chapter `···` menu in `GuideChapterBar` (non-destructive re-read with folded pass switcher + confirmation-gated explicit rollback) and update `CONTEXT.md`. | `05` |

## Issues

| # | Title | Phase | Status | Blocked by |
|---|---|---|---|---|
| 01 | Off-spine `stepRevision` storage in Rust & session tree helpers in TS | Phase 1 | resolved | — |
| 02 | Runtime & `GuideController` support for step revision, tip undo, and chapter rollback | Phase 2 | resolved | 01 |
| 03 | `GuideDocument` revision projection, tip recovery bar & latest-step undo | Phase 3 | resolved | 02 |
| 04 | Intentful re-explain popover & semantic per-step version switcher | Phase 4 | resolved | 03 |
| 05 | Chapter-level re-read grouping, explicit rollback dialog & domain doc update | Phase 5 | resolved | 02, 04 |

## Compatibility & Invariants

1. **Spine monotonicity invariant:** Except for tip-only undo (1 turn back) and confirmation-gated explicit chapter rollback, no retry or revision action may ever move `session.leafId` or `Guide cursor`.
2. **Side-thread stability invariant:** `GuideChapterRun.anchorEntryId` remains anchored to the spine's first step entry; in-place step revisions never rewrite spine user entries, so chapter `sideThread`s never detach.
3. **Zero JSONL migration & S3 `Sync` safety:** `stepRevision` entries live in the existing Pi Session JSONL and are ignored by spine leaf resolution and `newest_descendant` during remote merges (consistent with ADR `0001-s3-sync.md`).
4. **Legacy branch compatibility:** Existing Guided sessions with historical spine branches (`branchNavigation`) remain readable and switchable; new single-step retries produce `stepRevision` entries rather than new spine forks.
5. **Unified downstream consumption:** `GuideDocument` exposes the active revision as each step's canonical `explanation` / `blocks`, so `PageGuideCard`, Markdown export (`guide-export.ts`), Save-to-Note, search (`searchGuideDocument`), and future Guided TTS work seamlessly without per-consumer branching.
