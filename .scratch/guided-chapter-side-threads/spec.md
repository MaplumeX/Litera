# Spec: Chapter-scoped side-threads for Guided reading

Status: resolved

## Problem Statement

`GuideWorkspace` presents Guided reading as a chapter-scoped companion book (one `GuideChapterRun` per view), allowing the reader to flip back to earlier chapters while the Guide cursor sits further ahead. However, follow-up questions ("追问") still append linearly to the single active tip (`session.leafId`) of the Guided session:

1. **Wrong visual & semantic home.** Asking a question while viewing Chapter 3 forces `GuideWorkspace` to jump back to Chapter 4 (`focusRun(null)`) and attaches the Q&A underneath Chapter 4's latest step.
2. **Noisy, drifted LLM context.** The Agent sees Chapter 4's text and retelling at the front of its working window while Chapter 3 may already have been pruned or slid out by `guide_window_cut`. Follow-up turns also consume the guided spine's ~35k-token sliding window and disturb its Prompt Cache prefix.
3. **Destructive edits on historical questions.** Editing or regenerating an earlier follow-up rewinds `session.leafId`, hiding all subsequent guided chapters (`Ch4`, `Ch5`, …) behind a mutually exclusive branch fork.

## Core Decisions

1. **Pure guided spine + chapter-scoped side-threads (ALL follow-ups live on side-threads).**
   - Every follow-up question in a Guided session—whether asked in a historical chapter or in the latest chapter—is stored on a side-thread anchored to the viewed `GuideChapterRun`.
   - The guided spine (`activeBranch` ending at `session.leafId`) contains only guided progression (`guide_step` turns), silent `Chapter recap`s, and spine context maintenance (`guide_window_cut`, `context_prune`, `compaction`).
   - Prompting on a side-thread **never moves `session.leafId`**, never alters `guideCursor`, and never appears as a mutually exclusive sibling branch of the spine in `branchNavigation`.

2. **One chapter view, one chapter side-thread.**
   - Each `GuideChapterRun` owns a single chapter-level side-thread displayed in that chapter's view (below its `GuideStepSection`s), matching the one-chapter-per-screen layout.
   - The run's stable anchor ID is the spine entry ID of its first guided step (`run.steps[0]`'s anchor entry). Re-reading the same chapter later produces a distinct `GuideChapterRun` with its own first-step anchor ID and independent side-thread.
   - Pre-guide questions (asked before any `guide_step` exists) use a root side-thread anchor (`anchorId: null`), staying off the spine and rendering in the pre-guide view / first run.

3. **Zero JSONL migration & S3 Sync compatibility.**
   - Side-thread entries live inside the same Pi Session JSONL file as standard `PiSessionEntry` objects, tagged with a top-level `sideThread: { anchorId: string | null }` field.
   - Their `parentId` chains linearly within the side-thread, rooted at `anchorId` (so the JSONL remains a valid `parentId` tree with no dangling references).
   - Existing Guided sessions with legacy inline follow-up turns on the spine require no migration: `projectGuideDocument` merges legacy inline Q&As into the owning `GuideChapterRun`'s chapter-level `sideThreads` in chronological order.

4. **Chapter-accurate Agent context projection (no spoilers, intact chapter text, clean cache).**
   - When answering a follow-up in Chapter Run `R` (whose spine steps end at `endOfRunEntryId`):
     1. Take the spine prefix `activeBranch(session)` up to `endOfRunEntryId` (inclusive). Later chapters and later spine `guide_window_cut` / `context_prune` entries are excluded—so Chapter `R`'s full explanations (and unpruned step text) remain intact, and later chapters cannot leak or spoil.
     2. Project that prefix with `contextBranch` (preserving `bookSnapshot`, all `Chapter recap`s up to `R`, and the working window ending at `R`).
     3. Append the active branch of `R`'s side-thread (`Q1 -> A1 -> Q2 -> A2 -> …`).
   - **In-progress chapter continuity:** If Chapter 4 currently has `Step 1`, the reader asks `Q1`, then clicks Continue for `Step 2`, and asks `Q2`:
     - When answering `Q2`, `endOfRunEntryId` has advanced to `Step 2`, so the Agent sees **both** `Step 1 + Step 2` **and** `Q1/A1 -> Q2`.
     - Meanwhile, `Step 2` and `Chapter 5` on the spine never see `Q1/A1/Q2/A2`, keeping spine context lean and spine Prompt Cache intact.
   - **No accidental stepping from side-threads:** `guide_step` is not exposed during side-thread turns. Progression ("继续带读", skip, pick range, chapter jump) always runs through the guided controls onto the spine.
   - **Cross-chapter recall on demand:** `search_guide_history` indexes both spine retellings/recaps and all chapter side-threads (tagged with chapter metadata), and the Agent retains `read_chapter` / `search_in_book` when the reader explicitly asks about another chapter.

5. **Independent side-thread editing, regeneration, and maintenance.**
   - Editing or regenerating a follow-up question forks **only within that chapter's side-thread** (`parentId` rewinds to the previous side-thread entry or `anchorId`); `session.leafId` and all other chapters remain untouched.
   - Side-thread branch switching switches only that side-thread's active leaf (tracked per `anchorId` in memory / sidecar or defaulting to newest leaf), never affecting the spine.
   - Long side-threads perform their own `context_prune` / `compaction` tagged with the same `sideThread: { anchorId }`, never modifying the spine.

## Architecture Overview

```text
Guided Spine (session.leafId stays on latest guided step)
  Ch1(s1) ──► recap(Ch1) ──► Ch2(s1) ──► Ch3(s1..s2) ──► recap(Ch3) ──► Ch4(s1..s2) [leafId]
                                            │                              │
                                            │ sideThread{anchorId: ch3_s1} │ sideThread{anchorId: ch4_s1}
                                            ▼                              ▼
                                         Q1 ─► A1 ─► Q2 ─► A2          Q1 ─► A1

Context projection for Ch3 follow-up (Q2):
  contextBranch(spine[0 .. endOf(Ch3)])  +  sideThread(Ch3)[Q1, A1, Q2]
  └─ bookSnapshot + recaps(Ch1..Ch2) + Ch3(s1..s2)     └─ Ch3 Q&A chain (no Ch4)

Context projection for Ch4 Continue (Ch5):
  contextBranch(spine[0 .. leafId])
  └─ bookSnapshot + recaps(Ch1..Ch3) + Ch4(s1..s2)     (no side-thread noise)
```

## Storage & Rust Store Changes (`src-tauri/src/pi_sessions.rs`)

1. Helper `is_side_thread_entry(entry: &Value) -> bool` checking `entry.get("sideThread").is_some()`.
2. `PiSessionStore::append`: when the appended batch consists of side-thread entries, persist them to JSONL **without** overwriting `<session>.jsonl.leaf`. (Optimistic `expected_leaf_id` already validates existence in `ids`, so passing the side-thread's previous entry ID or `anchorId` works directly.)
3. `PiSessionStore::load` & `list`: when `.leaf` sidecar is absent, fall back to the newest **non-side-thread** entry (falling back to `entries.last()` only if no spine entry exists).
4. `PiSessionStore::merge_remote_session`: `newest_descendant` ignores side-thread entries when advancing `local_leaf`, while unioning all entries by ID so side-threads from multiple devices merge cleanly.

## Runtime & Projection Changes (TypeScript)

1. **`src/agent/sessions/pi-session.ts`**
   - Define `SideThreadRef = { anchorId: string | null }` and `isSideThreadEntry(entry)`.
   - `activeBranch(session)` remains the spine leaf-to-root path.
   - Add side-thread query helpers:
     - `sideThreadBranches(session)`: returns per-anchor active side-thread entry chains + per-side-thread `branchNavigation` (for editing/regenerating Q&As inside a side-thread).
     - `sideThreadContextEntries(session, anchorId, spineEndEntryId)`: builds the LLM context `[...contextBranch(spinePrefix), ...sideThreadContext(sideEntries)]`.
     - `branchNavigation(session)`: excludes side-thread entries from spine fork groups so side-threads never show up as sibling branches of spine steps.
2. **`src/agent/runtime/embedded-runtime.ts` & `src/agent/runtime/guide-controller.ts`**
   - Extend `askSideQuestion` / `prompt` with `sideThreadAnchorId` + `spineEndEntryId` (or derive `spineEndEntryId` from the active spine run owning `anchorId`).
   - Run side-thread prompts on a dedicated ephemeral/cached side-thread `Agent` (initialized from `sideThreadContextEntries`, without `guide_step` tool).
   - Never trigger `writeDueRecap` or spine `guide_window_cut` after a side-thread turn; run side-thread-scoped pruning/compaction only if the side-thread context exceeds budget.
   - Support `editSideTurn`, `regenerateSideTurn`, and `switchSideBranch` scoped to a side-thread without touching `session.leafId`.
   - Update `search_guide_history` to include all chapter side-threads.
   - Emit streaming/final events carrying `sideThreadAnchorId` (and updated side-thread snapshots in session events) so `useGuideBridge` / `agent-reducer` updates live UI cleanly.
3. **`src/lib/guide-document.ts` & `src/lib/guide-export.ts`**
   - Add `anchorEntryId: string` and `sideThreads: GuideSideQaNode[]` on `GuideChapterRun`.
   - Populate `run.sideThreads` from both new side-thread branches (keyed by `run.anchorEntryId`) and legacy inline Q&As (for backward compatibility).
   - Update `GuideChapterNode.questionCount`, `totalQuestions`, `searchGuideDocument`, `findRunIdForMessage`, and `formatGuideExportMarkdown` to read chapter-level `run.sideThreads`.
4. **`src/components/guide/*`**
   - `GuideWorkspace.tsx`: `handleSendQuestion` targets `activeRun?.anchorEntryId ?? null`, **stays on `activeRun`** (removes forced `focusRun(null)`), and scrolls to the bottom of the current chapter view.
   - `GuideChapterGroup.tsx` / `GuideStepSection.tsx`: move `GuideSideThread` rendering from per-step to chapter-level at the bottom of `GuideChapterGroup`, using side-thread edit/regenerate/branch callbacks.
   - `GuideNavRail.tsx`: jump-to-question targets `(runId, qaId)` and auto-expands that chapter's `GuideSideThread`.

## Rollout Plan

| Phase | Goal | Scope |
|---|---|---|
| **Phase 1: Storage & Session Tree** | Add `sideThread` entry support in Rust (`pi_sessions.rs`) and TS (`pi-session.ts`): leaf preservation, sync merge safety, spine/side-thread separation, and `sideThreadContextEntries` projection. | Rust + `pi-session.ts` + unit tests |
| **Phase 2: Runtime & Controller** | Add side-thread prompt, edit, regenerate, branch-switch, streaming events, and `search_guide_history` support in `embedded-runtime.ts` + `guide-controller.ts` + `agent-reducer.ts`. | Runtime + bridge + unit tests |
| **Phase 3: GuideDocument & Workspace UI** | Move `sideThreads` to `GuideChapterRun` (with legacy inline fallback), keep `handleSendQuestion` inside `activeRun`, render chapter-level `GuideSideThread`, and update `GuideNavRail` / search / Markdown export / mobile sheet. | `guide-document.ts` + `GuideWorkspace` + UI tests |

## Compatibility & Invariants

- **Zero JSONL migration:** Legacy Guided sessions without `sideThread` entries continue to render, search, and export with all historical Q&As preserved under their chapter runs.
- **S3 Sync safe:** Appending or syncing side-thread entries on one device never rewinds or hijacks another device's guided spine `leafId`.
- **Guide cursor invariant (`CONTEXT.md`):** Side-threads can never call `guide_step` or move `guideCursor`; `GuidePageMarks` and TOC progress depend strictly on the spine.
- **Domain terminology (`CONTEXT.md`):** Update `CONTEXT.md` under `Guided session` once implemented to note that follow-up Q&As branch per chapter off the Guided session's spine.

## Open Questions / Edge Cases to Verify During Implementation

1. **Multi-device side-thread leaf persistence:** Defaulting each chapter's active side-thread leaf to the newest entry in that side-thread requires zero extra sidecar files; only if a user explicitly switches a side-thread's edit/regenerate branch do we need a lightweight in-memory map (or optional sidecar entry) for that choice.
2. **Natural-language stepping in the input box:** If a user types "带读第 5 章" in the chapter Q&A box while `guide_step` is disabled on side-threads, the assistant can reply politely directing them to the GuideBar / TOC (or we can keep `guide_step` off in side-threads as the clean default and evaluate later if needed).
3. **Recap synthesis (future enhancement):** Out of scope for v1—`Chapter recap` continues to summarize the chapter's guided retelling from the spine only.
