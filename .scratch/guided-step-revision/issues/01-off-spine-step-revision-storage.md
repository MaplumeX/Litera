# 01: Off-spine `stepRevision` storage in Rust & session tree helpers in TS

**Status:** resolved

**Blocked by:** —

**What to build:** Extend Pi Session JSONL storage (Rust `src-tauri/src/pi_sessions.rs`) and session tree projection (TS `src/agent/sessions/pi-session.ts` + `src/types/agent.ts`) to support off-spine `stepRevision` entries alongside `sideThread` entries—preserving spine `leafId`, S3 `Sync` merge safety, and spoiler-free prefix context projection.

## Scope & Tasks

- [ ] **Rust storage (`src-tauri/src/pi_sessions.rs`):**
  - Generalize `is_side_thread_entry(entry: &Value) -> bool` to `is_off_spine_entry(entry: &Value) -> bool`, returning true when either `entry.get("sideThread").is_some_and(Value::is_object)` or `entry.get("stepRevision").is_some_and(Value::is_object)`.
  - Ensure `PiSessionStore::append`, `fallback_spine_leaf_id`, `resolved_spine_leaf_id`, and `merge_remote_session` (`newest_descendant`) all use `is_off_spine_entry` so appending or syncing `stepRevision` entries never overwrites `<session>.jsonl.leaf` or hijacks another device's spine leaf.
  - Add Rust unit tests covering:
    - Appending a `stepRevision` anchored to an earlier spine entry keeps `leaf_id` at the latest spine step.
    - Merging a remote session containing `stepRevision` entries unions them by ID without rewinding local `leaf_id`.
- [ ] **Shared types (`src/types/agent.ts`):**
  - Define `StepRevisionRef`:
    `{ targetAnchorId: string; revisionId: string; pace?: GuideStepPace; styleOverride?: string; modelId?: string; provider?: string }`.
  - Define `StepRevisionItem` and `StepRevisionSnapshot` (representing one step's ordered list of off-spine revisions with `revisionId`, `timestamp`, metadata, `content`, `blocks`, `stopReason`, `errorMessage`, and `activeRevisionId`).
- [ ] **TS session helpers (`src/agent/sessions/pi-session.ts`):**
  - Add `decodeStepRevision(entry)`, `isStepRevisionEntry(entry)`, and `isOffSpineEntry(entry)` (`isSideThreadEntry(entry) || isStepRevisionEntry(entry)`).
  - Ensure `branchNavigation`, `branchLeafId`, `sideThreadMiniSession`, and spine `visibleMessages` / `activeBranch` exclude `stepRevision` entries so step revisions never appear as sibling spine branches or leak into `sideThread`s.
  - Add `stepRevisionSnapshots(session, preferredRevisions?)`: groups `stepRevision` entries by `targetAnchorId` and `revisionId`, projecting each revision's assistant message (`content`, `blocks`, `stopReason`, `errorMessage`, metadata) while filtering out inactive empty failed attempts (`error` / `aborted` with no substantive output).
  - Add `applyActiveStepRevisions(entries, session, preferredRevisions?)`: when projecting model context (`contextBranch` or `sideThreadContextEntries`), replaces the assistant explanation of any spine step that has a selected active `stepRevision` (keeping the original `guide_step` tool call/result intact so step boundaries and `Guide cursor` never change).
  - Add `stepRevisionContextEntries(session, targetAnchorId, preferredRevisions?)`: builds the spoiler-free LLM context prefix strictly *before* `targetAnchorId` (`contextBranch(spine[0 .. before(targetAnchorId)])`), with active revisions applied to earlier steps in that prefix.
- [ ] **Unit tests (`src/agent/sessions/pi-session.test.ts`):**
  - Verify `stepRevision` entries are excluded from `activeBranch`, `visibleMessages`, `branchNavigation`, and `sideThreadSnapshots`.
  - Verify `stepRevisionSnapshots` groups multiple revisions per `targetAnchorId`, respects `preferredRevisions`, and suppresses inactive empty failed revisions.
  - Verify `stepRevisionContextEntries` excludes the target step's old explanation and all later chapters/steps, while preserving `bookSnapshot` and earlier `Chapter recap`s.
  - Verify `sideThreadContextEntries` reflects the active `stepRevision` of steps inside the viewed chapter.

## Acceptance Criteria

- `cargo test --manifest-path src-tauri/Cargo.toml pi_sessions` passes.
- `npx vitest run src/agent/sessions/pi-session.test.ts` passes.
- Zero changes required to existing Pi Session JSONL files; legacy sessions decode identically.

## Comments
