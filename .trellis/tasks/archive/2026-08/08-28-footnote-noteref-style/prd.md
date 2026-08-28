# Beautify footnote reference marks in reader content

## Goal

统一并美化 EPUB 正文中的脚注引用标记（上标数字）样式。目前标记样式完全依赖书籍自带 CSS，各家书籍不统一；本任务在阅读器注入的 CSS 中追加 noteref 规则，使其呈现一致的学术风上标样式。

## Background

- 脚注弹窗（`src/components/FootnotePopup.tsx`）已存在，本任务只处理**正文中的引用标记**，不改动弹窗。
- 注入 CSS 位于 `src/lib/reader-styles.ts` 的 `generateStylesCss()`（主视图）与 `footnotePopupCss()`（弹窗内视图，不在本任务范围）。
- 主题亮暗通过 `state.theme` 已可区分（`THEME_CSS`），标记的强调色需适配主题。

## Requirements

- 在 `generateStylesCss()` 生成的 CSS 中追加脚注引用标记规则，统一为学术风上标：
  - 字号缩小（约 0.72em）、垂直上对齐（`vertical-align: super` 或等效），去下划线。
  - 使用主题适配的强调色（亮色/暗色主题下均可读），与脚注弹窗入口的语义一致。
  - 仅作用于脚注引用标记，不影响普通链接、普通上标文本。
- 选择器需覆盖 EPUB 中常见写法：`a[epub\:type="noteref"]`、`[epub|type="noteref"]`、以及退化的 `sup a`（脚注引用常见的上标链接结构）。
- 样式对已有书籍是"覆盖式美化"：书籍自带样式不冲突时保持和谐，冲突时以注入样式为准（与现有 override 策略一致，可使用 `!important`）。

## Non-goals

- 不修改脚注弹窗本身的样式与排版（方向 A/B）。
- 不修改 `footnotePopupCss()`（弹窗内视图）。
- 不改功能逻辑（点击行为、定位等）。

## Acceptance Criteria

- [ ] `generateStylesCss()` 输出包含 noteref 样式规则，覆盖 `epub:type="noteref"` 与 `sup a` 等常见结构。
- [ ] 标记为缩小的上标数字、无下划线、强调色随主题（暗色主题下使用暗色主题的强调色）。
- [ ] 规则不误伤普通链接 / 普通上标（选择器足够精确）。
- [ ] `reader-styles.test.ts` 新增测试断言上述规则存在且随主题变化。
- [ ] `npm run test` 与 `tsc` 通过。

## Notes

- 轻量任务：PRD-only，无需 design.md / implement.md。
- 分支：`feat/footnote-styles`。