# Journal - Maplume (Part 2)

> Continuation from `journal-1.md` (archived at ~2000 lines)
> Started: 2026-08-21

---



## Session 88: Remove minimal thinking level from chat input

**Date**: 2026-08-21
**Task**: Remove minimal thinking level from chat input
**Branch**: `main`

### Summary

Removed 'minimal' from THINKING_LEVELS in ChatInput.tsx; thinking levels now off/low/medium/high/xhigh/max. tsc passes.

### Git Commits

| Hash | Message |
|------|---------|
| `4bd19fb` | (see git log) |

### Status

[OK] **Completed**


## Session 89: Agent 用户消息目录

**Date**: 2026-08-21
**Task**: Agent 用户消息目录
**Branch**: `feat/litera-agent-jump-user-messages`

### Summary

为内嵌 Agent 增加覆盖式用户消息目录，支持滚动高亮、平滑跳转、自动关闭、双语可访问性，并保持流式输出的自动贴底语义。

### Git Commits

| Hash | Message |
|------|---------|
| `5016841` | (see git log) |

### Status

[OK] **Completed**


## Session 90: Persist per-book reader layout

**Date**: 2026-08-21
**Task**: Persist per-book reader layout
**Branch**: `fix/reader-ai-dialog-open-state`

### Summary

Persisted chat pane, Agent book pane, and session-rail open state per book as lastLayout on BookRecord via update_reading_state. Restore on open; do not reset on Reader/Agent switch. Specs updated for the shelf contract.

### Git Commits

| Hash | Message |
|------|---------|
| `820fd41` | (see git log) |

### Status

[OK] **Completed**

## Session 90: Highlight colors, notes, and in-page editor

**Date**: 2026-08-21
**Task**: Highlight colors, notes, and in-page editor
**Branch**: `feat/litera-annotation-improvements`

### Summary

Shipped multi-color highlights, notes, and click-to-edit on painted marks. One-click highlight uses last-used color (process-only); list_annotations now returns color and optional note, still read-only. Specs record the optional annotations.json fields and the pointerup-vs-show-annotation paging gotcha.

### Git Commits

| Hash | Message |
|------|---------|
| `126f5da` | (see git log) |
| `46ac9cb` | (see git log) |
| `7f745ea` | (see git log) |

### Status

[OK] **Completed**


## Session 91: Override book fonts and typography

**Date**: 2026-08-22
**Task**: Override book fonts and typography
**Branch**: `feat/book-font-and-layout-override-settings`

### Summary

Added independent overrideFont and overrideLayout settings so user type can beat EPUB chapter CSS and embedded fonts. Defaults off; library is global, reader is per-book. Specs record Option<bool> false-as-override and the CSS selector split.

### Git Commits

| Hash | Message |
|------|---------|
| `d465ea8` | (see git log) |
| `94bcd62` | (see git log) |

### Status

[OK] **Completed**


## Session 92: Publish Litera 0.2.6

**Date**: 2026-08-23
**Task**: Publish Litera 0.2.6
**Branch**: `main`

### Summary

Bumped to 0.2.6, wrote changelog, tagged v0.2.6, and published the GitHub release after all three platform jobs succeeded. Draft notes filled; published with AppImage, deb, dmg, and NSIS exe.

### Git Commits

| Hash | Message |
|------|---------|
| `e5f8155` | (see git log) |

### Status

[OK] **Completed**


## Session 93: Restore reading position via CFI

**Date**: 2026-08-23
**Task**: Restore reading position via CFI
**Branch**: `main`

### Summary

Reopening a book now restores via lastCfi (foliate init lastLocation) instead of goToFraction, which was landing on the next page. lastFraction remains the library-card/scrubber percent. Specs record the fifth update_reading_state Option and the init({})+goTo trap.

### Git Commits

| Hash | Message |
|------|---------|
| `38ff0aa` | (see git log) |

### Status

[OK] **Completed**


## Session 94: Keep typography preview visible in settings

**Date**: 2026-08-23
**Task**: Keep typography preview visible in settings
**Branch**: `fix/settings-layout-preview-text-hidden-on-scroll`

### Summary

Split Settings → Typography into a left compact inspector (steppers and inline toggles) and a right live preview so scrolling no longer hides sample text. Dialog stays 768px; Appearance sliders unchanged.

### Git Commits

| Hash | Message |
|------|---------|
| `afc40e0` | (see git log) |

### Status

[OK] **Completed**


## Session 94: Improve library shelf management

**Date**: 2026-08-23
**Task**: Improve library shelf management
**Branch**: `feat/continue-improving-book-library`

### Summary

Planned and shipped library metadata editing (title/author/cover via update_book_metadata), five-way sort, grid/list views, card menus plus details dialog, and a continue-reading strip of up to four recently opened books. Specs record that post-import edits must not reuse save_book_metadata and that sort/view live in localStorage.

### Git Commits

| Hash | Message |
|------|---------|
| `837e33c` | (see git log) |
| `9f9f4db` | (see git log) |
| `c7dfb4d` | (see git log) |

### Status

[OK] **Completed**


## Session 95: Add nested collapse to the reader TOC sidebar

**Date**: 2026-08-23
**Task**: Add nested collapse to the reader TOC sidebar
**Branch**: `feat/collapse-headings-with-subtitles`

### Summary

Reader TOC now collapses nested headings via chevrons, defaults to the current chapter path, remembers expand state while the book is open, and offers expand-all / collapse-all. Specs record path keys in App.tocExpanded (process-only, not href, not persisted).

### Main Changes

- Chevron vs title click; empty href never goTo empty string
- tocExpanded lives in App so drawer remount keeps expansions; book switch resets
- currentHref change unions ancestor keys; collapse-all keeps current path
## Session 95: Paseo-style workspace conversation outline rail

**Date**: 2026-08-23
**Task**: Paseo-style workspace conversation outline rail
**Branch**: `feat/chatgpt-web-style-conversation-toc`

### Summary

Replaced the header-button overlay conversation TOC with a Paseo-style left-edge tick rail in Agent workspace. Reader/docked chat no longer has conversation outline UI. Hover-intent, dock magnification, and jump-without-unmounting the rail. Spec and changelog updated.

### Git Commits

| Hash | Message |
|------|---------|
| `a6ef219` | (see git log) |

### Testing

- [OK] npx vitest run: 53 files, 520 tests passed
- [OK] npm run build (tsc && vite build) passed
| `1f4c2c1` | (see git log) |

### Status

[OK] **Completed**


## Session 96: Rewrite bilingual README

**Date**: 2026-08-24
**Task**: Rewrite bilingual README
**Branch**: `main`

### Summary

Replaced the default README with an English version covering library, reader, assistant, install, and development; added README.zh-CN.md with the same content in Simplified Chinese.

### Git Commits

| Hash | Message |
|------|---------|
| `b7d45ee` | (see git log) |

### Status

[OK] **Completed**


## Session 97: Add README screenshots

**Date**: 2026-08-24
**Task**: Add README screenshots
**Branch**: `main`

### Summary

Added library and reader UI screenshots from docs/photos to the English and Chinese READMEs, replacing the favicon placeholder.

### Git Commits

| Hash | Message |
|------|---------|
| `30206ac` | (see git log) |

### Status

[OK] **Completed**


## Session 98: Match continue-reading cards to shelf grid

**Date**: 2026-08-24
**Task**: Match continue-reading cards to shelf grid
**Branch**: `fix/continue-reading-book-size`

### Summary

Continue-reading used grid-cols-4 and stretched covers to a quarter of the window. Reused the shelf auto-fill 140px grid, added a class-equality test, and documented the convention in frontend component-guidelines.

### Git Commits

| Hash | Message |
|------|---------|
| `75fb25d` | (see git log) |

### Status

[OK] **Completed**


## Session 99: Fix Agent chat outline rail layout

**Date**: 2026-08-24
**Task**: Fix Agent chat outline rail layout
**Branch**: `fix/litera-agent-toc-hover-all-items`

### Summary

Clustered Agent workspace outline ticks like Paseo (8px non-stretching slots, rail justify-center) and reserved a 48px left gutter when the rail is mounted so assistant content is not covered.

### Git Commits

| Hash | Message |
|------|---------|
| `72b6d89` | (see git log) |

### Status

[OK] **Completed**


## Session 100: Expand book details metadata editing

**Date**: 2026-08-25
**Task**: Expand book details metadata editing
**Branch**: `feat/metadata-editing-selection-and-fields`

### Summary

Details dialog no longer auto-selects the title. Users can edit description, publisher, language, and series on the shelf record. New imports prefill those fields from EPUB; already-imported books are not backfilled. Saves do not rewrite the EPUB. Specs record the extra BookRecord fields and the details-dialog focus rule.

### Git Commits

| Hash | Message |
|------|---------|
| `3731f0e` | (see git log) |
| `ec86da0` | (see git log) |
| `064318f` | (see git log) |

### Status

[OK] **Completed**


## Session 101: Publish Litera 0.2.8

**Date**: 2026-08-26
**Task**: Publish Litera 0.2.8
**Branch**: `main`

### Summary

Bumped to 0.2.8, wrote changelog, tagged v0.2.8, and published the GitHub release after all three platform jobs succeeded. Draft notes filled; published with AppImage, deb, dmg, and NSIS exe.

### Git Commits

| Hash | Message |
|------|---------|
| `3fb9720` | (see git log) |

### Status

[OK] **Completed**


## Session 102: Configurable column count setting

**Date**: 2026-08-27
**Task**: Configurable column count setting
**Branch**: `feat/configurable-column-count`

### Summary

Added columnCount (1-3, default 2) as a full TypographyKey: settings segmented control, ReaderView setColumnCount -> paginator max-column-count attribute with hot relayout, per-book + global persistence end-to-end including Rust validation (preferences.rs + library.rs). tsc/vitest(547)/cargo(174) all green; spec updated with paginator attribute notes and ReadingSettings contract.

### Git Commits

| Hash | Message |
|------|---------|
| `f1aeb51` | (see git log) |
| `0128032` | (see git log) |
| `006ceb1` | (see git log) |

### Status

[OK] **Completed**


## Session 103: Agent runtime iteration check: verify 6 commits, fix catalog api guard, add abort test

**Date**: 2026-08-28
**Task**: Agent runtime iteration check: verify 6 commits, fix catalog api guard, add abort test
**Branch**: `feat/litera-agent-runtime-iteration`

### Summary

Reviewed the 6 agent-runtime-iteration commits against AC1-AC6. All gates pass: tsc --noEmit, vitest 564 tests, cargo 179 tests, npm run build. Fixed one real defect: custom-provider catalog hits now require the catalog wire api to match the configured api (a custom OpenAI-compatible relay no longer inherits anthropic-messages from a claude-* id); added a regression test. Added the missing backoff-sleep abort normalization test (terminal aborted assistant persisted, prompt_aborted emitted). Security review clean: classifyPromptError returns preset strings only, title generation uses the guarded native fetch, probe writes numeric contextWindow only.
## Session 104: Beautify footnote noteref marks with theme-aware superscript style

**Date**: 2026-08-28
**Task**: Beautify footnote noteref marks with theme-aware superscript style
**Branch**: `feat/footnote-styles`

### Summary

Styled EPUB footnote reference marks as a consistent academic superscript via noterefCss() in generateStylesCss (0.72em, vertical-align super, no underline, accent #2563eb light / #6db4ff dark). Check phase caught that foliate parses chapter XHTML as XML, so [epub\\:type] matches nothing; fixed with @namespace epub + [epub|type] as the first stylesheet statement, plus sup > a[href^="#"] fallback. Rejected a[href*="#fn"] as too broad. 549 tests + tsc pass. Archived 08-28-footnote-noteref-style.

### Git Commits

| Hash | Message |
|------|---------|
| `92e3810` | (see git log) |
| `dd0ed2a` | (see git log) |
| `de13a75` | (see git log) |
| `29716c5` | (see git log) |
| `3b4020f` | (see git log) |
| `37962a2` | (see git log) |
| `229e6c1` | (see git log) |
| `5ac33ad` | (see git log) |
| `fd4c1b2` | (see git log) |

### Status

[OK] **Completed**


## Session 105: Fix footnote noteref style for a>sup structure

**Date**: 2026-08-29
**Task**: Fix footnote noteref style for a>sup structure
**Branch**: `clean-elk`

### Summary

Real-world EPUBs (置身事内, 黑格尔小逻辑绎注) write footnote references as <a href><sup>1</sup></a> with sup inside the link and often cross-file hrefs, so none of the existing noteref selectors (epub:type variants, sup > a[href^="#"]) matched and the accent style never applied. Added a[href] > sup to style the visible mark and a[href]:has(> sup) to de-underline/color the wrapper link; child combinators keep sibling note-body sups unstyled. :has() is safe in Tauri v2 WebViews (Safari 15.4+/Chromium 105+) with graceful degradation otherwise. Updated reader-styles tests (30 pass) and tsc clean. Diagnosed by extracting both books' EPUB markup.

### Git Commits

| Hash | Message |
|------|---------|
| `98611b3` | (see git log) |

### Status

[OK] **Completed**


## Session 106: Fix footnote noteref style for a>sup structure

**Date**: 2026-08-29
**Task**: Fix footnote noteref style for a>sup structure
**Branch**: `clean-elk`

### Summary

Diagnosed why footnote noteref style did not apply: real-world EPUBs (置身事内, 黑格尔小逻辑绎注) write references as <a href><sup>1</sup></a> with cross-file hrefs, missing all three existing selectors (epub:type attrs, sup>a). Added a[href] > sup for the visible mark and a[href]:has(> sup) to de-underline the wrapper link; child combinators keep sibling note-body sups unstyled. 30 reader-styles tests + full suite (567) pass; spec updated.

### Git Commits

| Hash | Message |
|------|---------|
| `98611b3` | (see git log) |
| `3c2ba58` | (see git log) |

### Status

[OK] **Completed**


## Session 107: Restore noteref mark size to 0.83em

**Date**: 2026-08-29
**Task**: Restore noteref mark size to 0.83em
**Branch**: `feat/optimize-footnote-styles`

### Summary

User reported footnote reference marks (#32's 0.72em) felt too small vs the pre-styling browser <sup> default (~0.83em). Bumped noterefCss() font-size to 0.83em in both rule blocks, updated the three test assertions, and synced the spec's 0.72em mention. Implement + check sub-agents (glm-5.3-flash) verified: 567 tests pass, tsc clean. Archived task 08-29-noteref-size-restore.

### Git Commits

| Hash | Message |
|------|---------|
| `6f652f7` | (see git log) |

### Status

[OK] **Completed**


## Session 108: Hierarchical TOC with anchor-level chapter splitting

**Date**: 2026-08-29
**Task**: Hierarchical TOC with anchor-level chapter splitting
**Branch**: `feat/read-chapter-heading-levels`

### Summary

Agent chapter projection now mirrors the human-visible TOC: parseNav/parseNcx keep nesting depth + ancestor paths, parseSpineSegments slices spine files at id/<a name> anchors, buildOwnedChapters v2 grants per-segment ownership so multiple TOC entries can share one spine file (previously dropped). get_toc/snapshot/chapterAside/search expose path+depth; container entries collapse into ancestors; unresolvable fragments fall back without text loss (union invariant tested). Verified against two real EPUBs (置身事内: 3-level hierarchy, 黑格尔小逻辑绎注: 4 sections per file, exact per-section slices). 590 tests green, tsc clean, tool surface/RPC/hrefs-hidden unchanged. Spec quality-guidelines.md updated.

### Git Commits

| Hash | Message |
|------|---------|
| `04f7f3d` | (see git log) |

### Status

[OK] **Completed**


## Session 109: read_chapter structured Markdown projection

**Date**: 2026-08-29
**Task**: read_chapter structured Markdown projection
**Branch**: `feat/read-chapter-structured-content`

### Summary

read_chapter now returns structured Markdown (paragraphs, headings, emphasis, quotes, lists, verbatim pre) instead of flattened text. Dual projection: flat text walk unchanged (search trigram index/snippets stay on it, per-segment dense-equal guard falls back to flat on mismatch); structured markdown walk emits block roots as own blocks with transparent container recursion, anchors inside div/section aligned with the flat anchor stream. Multi-slice chapter markdown joins with \n\n. chapterWindows does paragraph-aligned greedy packing into <=12k windows with hard-split residual repacking. get_toc chars = markdown length; tool description updated; spec updated incl. search part approximation note. Check round caught and fixed 2 blockers (div-wrapped nested blocks flattened; multi-segment markdown joined with '') plus nested-anchor swallowing and inlineOf self-delimiter gaps. 613/613 tests green, tsc clean.

### Git Commits

| Hash | Message |
|------|---------|
| `2cdfb65` | (see git log) |

### Status

[OK] **Completed**


## Session 110: Agent chat ordered content blocks

**Date**: 2026-08-30
**Task**: Agent chat ordered content blocks
**Branch**: `fix/litera-agent-event-stream-ordering`

### Summary

Fixed chat UI event-stream flattening: replaced flat thinking/toolCalls assistant fields with ordered AssistantBlock list (thinking|text|toolCall). Reducer folds deltas in event order; visibleMessages() rebuilds blocks from persisted entries including thinking (previously dropped on reload) and merges consecutive assistant entries; AssistantMessage renders blocks in array order. Full suite + tsc green; spec state-management.md updated.

### Git Commits

| Hash | Message |
|------|---------|
| `0bb9108` | (see git log) |

### Status

[OK] **Completed**
