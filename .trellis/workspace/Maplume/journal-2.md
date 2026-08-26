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
