# 01: Single canonical Guided session per Book

**Status:** resolved

**Blocked by:** —

**What to build:** Make each Book have one canonical Guided session instead of letting users create multiple competing Guided sessions, while keeping legacy multi-guide books accessible without data loss.

- [x] Domain & UI entry: replace "New guided reading" in `SessionList` with a single dedicated book-level Guide entry (creates the Guided session on first open, or switches directly to the existing canonical Guided session)
- [x] Legacy compatibility: when a Book already has multiple `kind: "guided"` sessions on disk, treat the most recently updated one as the canonical Guide and keep older Guided sessions readable (clearly badged as legacy/archived) without deleting or migrating their JSONL files
- [x] Single-chapter re-read & full restart escape hatches:
  - Allow re-reading an already-covered chapter in place (via existing TOC pick / `guide_step(chapterIndex)` or branch re-explain)
  - Add a low-frequency "Archive current guide & start over" action in guide settings (marks the old session as archived/legacy and creates a fresh canonical Guided session)
- [x] Update `CONTEXT.md` Guided session definition to reflect one canonical Guided session per Book
- [x] Tests: `SessionList`, `ChatPanel` session switching/creation, legacy multi-guided session fallback

## Comments
