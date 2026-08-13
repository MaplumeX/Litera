# Restore reader page turning

## Goal

桌面端打开书后，用页边点击、方向键、触控板/滚轮就能翻上一页 / 下一页。点过正文后仍然有效。不恢复底栏翻页按钮。

## Background

`08-12-modernize-reader-ui` 删掉了底栏「上一页 / 下一页」，并假设 foliate-js 自带键盘、滚轮、页边点击。假设不成立：

- `src/App.tsx:211-232` 只在父窗口听 `ArrowLeft` / `ArrowRight`。书页在 iframe 里，点过正文后按键到不了这个监听。
- `src/components/ReaderView.tsx:173-178` 已暴露 `prev` / `next`，内部转到 `foliate-view`。
- foliate-js 点击只处理链接；paginator 有触摸滑动，没有 `wheel`；分页模式 `#container` 为 `overflow: hidden`。
- macOS 触控板发的是 `wheel`，不是 touch。
- 顶栏进度条只读。目录跳转仍可用，但那是跳章。

详见 `research/foliate-paging-events.md`。

## Requirements

- **R1** 页边点击翻页：左右约 1/3 单击翻页，中间 1/3 留给划词。不要用盖住正文的透明遮罩。
- **R2** 方向键翻页：`←` / `→` 在书页 iframe 有焦点、以及焦点在阅读器非输入区域时都有效。
- **R3** 触控板 / 鼠标滚轮翻页：向下或向右翻下一页，向上或向左翻上一页。一次手势只翻一页，不能连跳。
- **R4** 划词选中和「问 agent」不受翻页破坏：拖选、点链接不翻页。
- **R5** 焦点在聊天输入、设置对话框、其它文本控件里时，方向键不翻页。
- **R6** 翻页继续走现有 `relocate` → 进度条更新 → debounce 持久化。
- **R7** 不改 `src/foliate-js/` 子模块，不改阅读模式为 scrolled。

## Acceptance Criteria

- [ ] 打开书后，点正文左侧约 1/3 到上一页，右侧约 1/3 到下一页。
- [ ] 点中间约 1/3、拖选文字、点书内链接，不翻页；「问 agent」仍可用。
- [ ] 点过正文后按 `←` / `→` 仍能翻页。
- [ ] 聊天输入框或设置对话框里按 `←` / `→` 不翻页。
- [ ] 触控板或滚轮能翻页，一次手势只翻一页。
- [ ] 翻页后顶栏进度百分比更新。
- [ ] 没有恢复底栏「上一页 / 下一页」按钮行。
- [ ] `npm test` 与 `npm run build` 通过。

## Out of Scope

- 进度条拖拽跳转
- 翻页动画 / 仿真翻页
- 空格、PageUp / PageDown
- 固定版式 EPUB（`foliate-fxl`）专项适配
- 恢复底栏翻页按钮
- 修改 foliate-js 子模块

## Decisions

- **D1** 交互模型：页边点击 + 方向键 + 滚轮。不加回可见翻页按钮。
- **D2** 点击分区：左右约 1/3，中间留给划词。
- **D3** 空间方向（点击、左右键）跟阅读方向走（LTR 左=上一页；RTL 用 `goLeft` / `goRight`）。滚轮按阅读顺序：下/右=下一页。
