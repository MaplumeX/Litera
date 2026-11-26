# 05: Three-mode `ReaderMode` (`reader | guide | agent`) & persistence

**Status:** resolved

**Blocked by:** 04

**What to build:** Promote Guided reading to a top-level mode alongside plain Reading and free-form Agent Q&A (`ReaderMode = "reader" | "guide" | "agent"`), updating TypeScript & Rust persistence validation, Settings defaults, desktop shell routing (`App.tsx`), and removing the canonical Guide from `SessionList` so Agent mode becomes pure multi-session Q&A.

## Scope & Tasks

- [ ] Extend `ReaderMode` to `"reader" | "guide" | "agent"`:
  - `src/lib/reader-mode.ts`: update `ReaderMode`, `isReaderMode()`, `parseReaderMode()`, `resolveReaderMode()`.
  - `src/types/library.ts`: widen `lastReaderMode?: "reader" | "guide" | "agent"`.
  - `src-tauri/src/library.rs`: update `lastReaderMode` validation (around lines 197 and 2811) to accept `"reader"`, `"guide"`, and `"agent"`, and add Rust unit tests covering `"guide"` round-trip and invalid rejection.
- [ ] Update desktop top bar & shell layout in `src/App.tsx`:
  - Upgrade the segmented mode switcher (`reader` / `agent`) to a 3-way switcher: **Reader (`阅读`) / Guide (`带读`) / Agent (`问答`)** (update `src/locales/zh-CN.ts` and `src/locales/en.ts`).
  - Route the main workspace cell cleanly:
    - `reader`: Book primary + optional docked `ChatWorkspace` card on the right.
    - `guide`: `GuideWorkspace` primary (using the Book's canonical Guided session; auto-creates one on first entry when absent) + optional collapsible Book card on the right (`bookCollapsed` & `agentBookWidth` reused or extended in `ReaderLayout`).
    - `agent`: `ChatWorkspace` primary (with `SessionList` rail) + optional collapsible Book card on the right.
  - Ensure `PageGuideCard` "Open in guide", `SelectionToolbar` "Guide up to here", and TOC "Guide this chapter" switch to or focus `GuideWorkspace` directly without depending on `ChatPanel`.
  - Ensure `Sitting` time tracking (`session.readingTracker`) counts active time in `guide` mode identically to `reader` and `agent`.
- [ ] Update `SettingsDialog` (`src/components/settings/SettingsDialog.tsx`):
  - Add `"guide"` option to the default opening mode selector alongside `"reader"` and `"agent"`.
- [ ] Clean up `SessionList.tsx`:
  - Remove the pinned canonical Guide row and `onNewGuided` creation trigger from `SessionList` (ordinary Agent mode focuses purely on free-form Sessions).
  - Keep any legacy/archived `kind: "guided"` sessions accessible (either via a read-only "Archived guides" submenu in Guide settings or a clearly badged legacy section) so zero historical user data is hidden.
- [ ] Update `CONTEXT.md`:
  - Refine **Guided session** and **Sitting** definitions to reflect the three-mode shell (`reader`, `guide`, `agent`).
- [ ] Tests:
  - Rust: `cargo test` for `library.rs` `lastReaderMode` `"guide"` persistence.
  - Frontend: `src/lib/reader-mode.test.ts`, `src/App.reader-mode.test.tsx`, `src/components/settings/SettingsDialog.test.tsx`, `src/components/chat/SessionList` tests.

## Acceptance Criteria

- Users can switch directly between Reading, Guide, and Agent modes in the desktop titlebar; the last mode persists per Book across restarts.
- Entering Guide mode always lands in the Book's canonical Guided workspace (never mixed with free-form chat sessions); entering Agent mode lands in pure multi-session Q&A.
- All existing books with `"reader"` or `"agent"` saved continue to open cleanly without migration.

## Comments
