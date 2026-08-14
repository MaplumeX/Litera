# Fix click page-turn hit testing

## Goal

点正文左约 1/3 翻上一页、右约 1/3 翻下一页，在多页章节的任意一页上都成立。中间 1/3 仍留给划词。

## Background

`08-13-restore-reader-paging` 已经接上了页边点击，但 iframe 路径把 `clientX` 对上了 `doc.defaultView.innerWidth`。foliate-js 分页器会把 iframe 拉成「整章页宽」，`innerWidth` 是整章，不是当前可见页。短章（只有 1 页）看起来正常；长章里点正文会整页判成左、中或右。

宿主留白路径（相对 `foliate-view` 可见宽度）是对的。键盘、滚轮不走这套坐标，不受影响。

详见 `research/foliate-iframe-geometry.md`。

## Requirements

- **R1** 正文点击分区相对**当前可见页/跨页**（一屏），不是 iframe 整章宽度。左三分之一 `goLeft()`，右三分之一 `goRight()`，中间不翻页。
- **R2** 章内任意一页（含首页、中段、末页）分区一致。不能出现「越往后整页都是下一页」。
- **R3** 保留现有单击判定：主键、位移 < 约 5px、无未折叠选区、目标不是 `a[href]`。拖选和点链接仍不翻页。
- **R4** 宿主留白点击、方向键、滚轮手势、划词「问 agent」行为不变。
- **R5** 不改 `src/foliate-js/`，不加盖住正文的透明遮罩，不改 `flow="scrolled"`。

## Acceptance Criteria

- [ ] 多页章节的首页、中段、末页：点正文左侧约 1/3 到上一页，右侧约 1/3 到下一页。
- [ ] 点中间约 1/3、拖选文字、点书内链接，不翻页。
- [ ] 点阅读器左右留白仍能按空间方向翻页（现有宿主路径）。
- [ ] 点过正文后 `←` / `→`、触控板/滚轮一次手势一页，行为与现在相同。
- [ ] `src/lib/reader-paging.test.ts` 覆盖「整章坐标 → 可见页坐标」的映射；`npm test` 与 `npm run build` 通过。

## Out of Scope

- 键盘、滚轮阈值或手势逻辑
- 翻页动画、底栏按钮、进度条拖拽
- 固定版式 EPUB（`foliate-fxl`）专项适配
- 竖排（`vertical-rl` / `vertical-lr`）专项适配
- 修改 foliate-js 子模块

## Decisions

- **D1** 分区参照物是当前可见页，不是整个 `foliate-view`（宽屏两侧空白很大，正文会落在宿主中间三分之一）。
- **D2** 空间方向不变：左 → `goLeft()`，右 → `goRight()`。
- **D3** 坐标换算抽到 `reader-paging.ts` 纯函数，用单页宽做正向取模；不要用 `innerWidth`，也不要把未换算的 `clientX` 直接拿去和单页宽比。
