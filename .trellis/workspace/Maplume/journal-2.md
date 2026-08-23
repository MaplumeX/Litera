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
