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


## Session 111: Redesign agent thinking & tool call UI

**Date**: 2026-08-30
**Task**: Redesign agent thinking & tool call UI
**Branch**: `feat/litera-agent-runtime-toolcall-styles`

### Summary

Researched agent UI patterns (Claude collapsed trace, ChatGPT Deep Research, Cursor, DeerFlow), then redesigned Litera chat thinking/tool-call blocks: replaced gray boxes with left-hairline de-emphasized style, added running/success/error lifecycle states to ToolCallCard, scrollable truncated results with copy button, shared CopyButton component, 5 new i18n keys, 9 new tests. 627 tests + build pass.

### Git Commits

| Hash | Message |
|------|---------|
| `912bbae` | (see git log) |

### Status

[OK] **Completed**


## Session 112: Drop left hairline on thinking/tool rows

**Date**: 2026-08-31
**Task**: Drop left hairline on thinking/tool rows
**Branch**: `feat/litera-agent-runtime-toolcall-styles`

### Summary

User feedback: stacked left border lines looked noisy. Switched thinking and tool-call blocks to borderless rows with subtle hover background (option A); removed border assertions from error-state test.

### Git Commits

| Hash | Message |
|------|---------|
| `74c4100` | (see git log) |

### Status

[OK] **Completed**


## Session 113: Fix agent message edit confirm button index mismatch

**Date**: 2026-09-05
**Task**: Fix agent message edit confirm button index mismatch
**Branch**: `fix/litera-agent-runtime-message-confirm-button`

### Summary

Diagnosed the dead edit-confirm button in the embedded agent runtime: UI bubble indexes (visibleMessages) diverged from the runtime's raw entry filtering after tool-call turns, so edits either failed with a masked 'model request failed' error or silently rewound to the wrong branch point. Fixed by adding visibleMessageEntries() as the single source of truth for UI-index-to-entry mapping (shared traversal with visibleMessages), resolving editIndex through it in the runtime, surfacing the local validation error verbatim, and treating a null leafId as an empty branch in activeBranch(). Added invariant tests, runtime edit regression tests (tool-turn edit, first-message edit, invalid targets), and kept the ChatPanel confirm-button tests. All 636 tests and build pass. Updated frontend state-management spec.

### Git Commits

| Hash | Message |
|------|---------|
| `e3195c3` | (see git log) |

### Status

[OK] **Completed**


## Session 114: Chat quick model switcher

**Date**: 2026-09-06
**Task**: Chat quick model switcher
**Branch**: `feat/litera-chat-model-switcher`

### Summary

Added a ModelSwitcher chip to the chat composer toolbar: lightweight popover lists the current provider's models (pi-ai static catalog for built-in providers via new listBuiltinModelIds(); persisted models for custom providers), item click calls switch_provider through useAgentConfig().switchProvider and invalidates the runtime cache. ChatInput gained an additive leadingControls slot; unconfigured state opens AgentConfigDialog; streaming disables the switcher. i18n en+zh-CN; 648 tests green, tsc clean. Specs updated with the ModelSwitcher exception to the draft-only provider dropdown convention.

### Git Commits

| Hash | Message |
|------|---------|
| `41d6be0` | (see git log) |

### Status

[OK] **Completed**


## Session 115: ChatGPT-style message branch switching

**Date**: 2026-09-06
**Task**: ChatGPT-style message branch switching
**Branch**: `feat/session-branch-message-switching`

### Summary

Implemented full branch-switching across all layers: branchNavigation/branchLeafId pure functions in pi-session.ts (grouped by preceding user message, active index via true leaf-to-root path for compaction safety); Rust .jsonl.leaf sidecar pointer with set_agent_session_leaf IPC and relaxed append optimistic lock (expected leaf must exist, not be last); runtime switchBranch/switchBranchAtAnchor with prompt-streaming guard; branch_switched event plus navigation payloads on session_switched/prompt_end/prompt_aborted; reducer branchNavigation/branchAnchors state with full lifecycle reset coverage; BranchSwitcher UI ([<] 2/3 [>]) in the reserved h-6 action row with streaming-disable and edit-cancel handling. All gates green: 689 vitest, 183 cargo tests, clippy, tsc. Remaining: manual smoke test in Tauri dev (edit -> switch -> continue on old branch -> restart persists).

### Git Commits

| Hash | Message |
|------|---------|
| `f24dfb9` | (see git log) |

### Status

[OK] **Completed**


## Session 116: Replace abort input backfill with regenerate affordance

**Date**: 2026-09-07
**Task**: Replace abort input backfill with regenerate affordance
**Branch**: `emdash/rare-olives-tan-ew0az`

### Summary

移除 abort 后回填输入框的旧设计（lastSentRef/abortedRef/retryHighlight），改为业界标准的三意图分离：abort=停止、regenerate=重发、edit=改写。新增对话流底部常驻 Regenerate 按钮（复用 editPrompt 原文重发生成 sibling branch）；用户消息 entry payload 持久化 selection/chapterHref 并经 visibleMessages 投影回 UI；aborted assistant 消息显示"已停止"标签。Rust 侧纯透传无需改动。全量 703 测试 + tsc 通过，spec 已更新（state-management.md / quality-guidelines.md）。

### Git Commits

| Hash | Message |
|------|---------|
| `b7d1374` | (see git log) |

### Status

[OK] **Completed**


## Session 117: Agent chat LaTeX math rendering

**Date**: 2026-09-07
**Task**: Agent chat LaTeX math rendering
**Branch**: `emdash/whole-planets-roll-pj1nx`

### Summary

Added KaTeX math rendering to assistant chat messages: remark-math + rehype-katex (katex 0.16 line) in AssistantMessage TextBlock, normalizeLatexDelimiters pre-pass rewriting \[...\]/\(...\) delimiters and flow-ifying single-line $$...$$, global .katex-display overflow fallback. Check pass removed the output:'html' option to preserve the MathML screen-reader fallback. All 710 tests and npm run build pass; fonts ship as local /assets/ resources satisfying CSP. Spec updated in frontend/component-guidelines.md (companion library row + math rendering convention).

### Git Commits

| Hash | Message |
|------|---------|
| `2678951` | (see git log) |

### Status

[OK] **Completed**


## Session 119: Move regenerate button next to copy button

**Date**: 2026-09-08
**Task**: Move regenerate button next to copy button
**Branch**: `feat/move-regenerate-next-to-copy`

### Summary

把「重新生成」按钮从消息流底部居中位置移到最后一条可见 assistant 消息的按钮行，与 CopyButton 并排（AssistantMessage 新增 onRegenerate prop，仅最后一个 text 块渲染；无 text 块消息回退到自身按钮行；最后一条是 user 消息时保留底部按钮）。handleRegenerate 逻辑与 i18n key 未变。check 阶段发现并修复了纯 thinking/toolCall 消息丢按钮的边界问题。全量 714 测试 + tsc 通过，spec（state-management.md regenerate 位置描述）已更新。
## Session 118: Fix thinking-level trigger dark-mode background

**Date**: 2026-09-08
**Task**: Fix thinking-level trigger dark-mode background
**Branch**: `emdash/solid-dingos-retire-8o82g`

### Summary

Fixed the chat thinking-level select showing a translucent white patch in dark mode: SelectTrigger base styles (dark:bg-input/30 dark:hover:bg-input/50) were not overridden by the plain bg-transparent class in ChatInput. Added dark:bg-transparent dark:hover:bg-transparent overrides. Verified with ChatInput tests and tsc --noEmit. No Trellis task (direct small fix per user request).

### Git Commits

| Hash | Message |
|------|---------|
| `9ffc152` | (see git log) |
| `a486fa2` | (see git log) |

### Status

[OK] **Completed**
