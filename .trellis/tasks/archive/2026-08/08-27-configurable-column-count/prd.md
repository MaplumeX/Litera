# Configurable column count in settings

## Goal

在 设置 → 排版 中新增"分栏数"配置，让用户控制阅读器的分栏数量，覆盖 foliate-js 的自动分栏行为。

## Background

- 阅读器分栏由 foliate-js paginator 控制：原生属性 `max-column-count`（默认 2；竖屏容器回退 `--_max-column-count-portrait: 1`），paginator 会取 `min(maxColumnCount, ceil(size / maxInlineSize))`，即实际栏数不会超过容器能容纳的栏数。
- 现有排版设置管线：`TypographyKey`（src/lib/reader-styles.ts）→ per-book 覆盖（`ReadingSettings`，src/types/library.ts）+ 全局偏好（preferences）→ `SettingsDialog` 分段控件 → `ReaderView.setStyles` handle 应用。
- 当前未给 paginator 设置过 `max-column-count`，走默认值 2。

## Requirements

1. 新增排版项 `columnCount`：
   - 取值：`1` / `2` / `3`（栏数），默认 `2`（与 foliate 当前默认一致，现有用户无感知变化）。
   - 作为 `TypographyKey` 之一进入现有管线：per-book 覆盖、全局偏好持久化、恢复默认按钮、"编辑默认/编辑某本书"作用域逻辑全部照常生效。
2. 设置 → 排版 面板新增"分栏数"行，使用与"对齐"一致的 SegmentedControl（1 / 2 / 3）。
3. 应用逻辑：
   - `ReaderView` 打开书时向 paginator 设置 `max-column-count`；设置变化时热更新（不重开书、不丢阅读位置）。
   - foliate 自身的约束保留：竖屏容器仍回退 1 栏；容器容不下时实际栏数自动减少（`min(maxColumnCount, ceil(size / maxInlineSize))`），无需本应用额外处理。
4. 排版预览（TypographyPreview）不需要模拟多栏效果，保持现状即可。
5. 文案：中英文 locale 各新增 `settings.columns` 等条目。

## Out of Scope

- 不修改 src/foliate-js 子模块代码。
- 不改预览的多栏渲染、不做"自动"档位（回到自动 = 恢复默认 2 栏）。
- 不改脚注弹窗（内部视图固定 scrolled flow，与分栏无关）。

## Acceptance Criteria

- [ ] 设置 → 排版 出现"分栏数"行，可选 1 / 2 / 3，默认 2。
- [ ] 切换分栏数后阅读器立即生效（iframe 内分栏数变化），阅读位置不丢失。
- [ ] "编辑某本书"作用域下修改只写入该书 snapshot；"编辑默认"作用域下写入全局偏好；两者互不串扰。
- [ ] 覆盖后行尾出现"恢复默认"链接，点击后回到默认 2 栏并移除该覆盖。
- [ ] 窄容器（如半屏并排阅读）中设置 2/3 栏时，实际栏数由 foliate 自动收敛，无横向溢出。
- [ ] `tsc`、`vitest` 全绿；`reader-styles`、`SettingsDialog`、`ReaderView` 相关测试覆盖新逻辑（normalize、clamp、per-book 覆盖、热更新调用）。