# Fix chapter-boundary click paging zones

## Goal

正文左右三分之一点击翻页在长章末页和刚进入下一章后仍然一致：同一屏幕位置不会先下一页再上一页。

## Background

用户在长章末页点击同一位置先翻到下一章，再点一次又翻回上一章。

`08-14-fix-click-paging-hit` 已用 `pageLocalX` 把 iframe `clientX` 折进单页，但页宽取了 `document.documentElement.clientWidth`（`ReaderView.tsx` `handleLoad` / `pageWidthOf`）。根元素的 `clientWidth` 按 CSSOM 返回 iframe **视口**宽度，而分页器把 iframe 拉成整章长条，所以长章上取模是空操作。末页整页被判成右侧（下一页）；新章首页整页被判成左侧（上一页）。单页章碰巧正确。

键盘、滚轮、宿主留白路径不走 iframe 页宽，不受影响。证据见 `research/document-element-client-width.md`。

## Requirements

- **R1** iframe 正文点击分区相对**当前可见页/跨页**，页宽必须是 `<html>` 的布局宽度，不能是 `documentElement.clientWidth` 或 `window.innerWidth`。左三分之一 `goLeft()`，右三分之一 `goRight()`，中间不翻页。
- **R2** 长章末页点右侧约 1/3 进入下一章后，同一屏幕位置再点右侧约 1/3 仍是下一页，不能变成上一页。章内首页、中段、末页分区一致。
- **R3** 保留现有单击判定：主键、位移 < 约 5px、无未折叠选区、目标不是 `a[href]`。
- **R4** 宿主留白点击、方向键、滚轮手势、划词行为不变。
- **R5** 不改 `src/foliate-js/`，不加盖住正文的透明遮罩，不改 `flow="scrolled"`。

## Acceptance Criteria

- [ ] 多页章节末页：点正文左侧约 1/3 到上一页，右侧约 1/3 到下一页（含翻到下一章）。
- [ ] 刚进入下一章后，同一屏幕位置点右侧约 1/3 仍到下一页，不会回到上一章。
- [ ] 单页章节、章内中段：左右三分之一分区与现在的预期一致。
- [ ] 点中间约 1/3、拖选文字、点书内链接，不翻页。
- [ ] 点阅读器左右留白、`←` / `→`、滚轮手势行为不变。
- [ ] `src/lib/reader-paging.test.ts` 覆盖「不能用根元素 `clientWidth` / `innerWidth` 当页宽」；`npm test` 与 `npm run build` 通过。

## Out of Scope

- 键盘、滚轮阈值或手势逻辑
- 翻页动画、进度条拖拽
- 固定版式 EPUB、竖排专项适配
- 修改 foliate-js 子模块
- 改点击分区比例（仍是左/中/右约三分之一）

## Decisions

- **D1** 页宽取 `<html>` 布局宽度（`getBoundingClientRect().width` 或 `offsetWidth`），禁止根元素 `clientWidth`。
- **D2** 继续用 `pageLocalX` 正向取模；问题在除数，不在取模本身。
- **D3** 轻量任务：只改页宽来源与测试；坐标换算仍留在 `reader-paging.ts`。
