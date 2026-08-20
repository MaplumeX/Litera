# 修复脚注弹窗高度、样式与定位

## Goal

点击 EPUB 脚注引用时，弹窗贴着该引用出现，高度贴合脚注正文，看起来是一张紧凑卡片。字体、字号、主题仍跟随阅读器。

## Background

脚注弹层已在 `08-19-reader-footnotes` 落地（`FootnotePopup.tsx` + `ReaderView.tsx` 的 `handleLink` / `handleFootnoteBeforeRender`）。当前弹窗高度、内嵌样式和定位都不适合卡片场景：

- 高度用 `innerDoc.body.getBoundingClientRect().height`（`ReaderView.tsx` 约 626–631 行），未加载时占位 160px，上限视口 60%（`FootnotePopup.tsx`）。短注容易留大片空白；书 CSS 若给 `html/body` 设了 `min-height`，会继续被撑高。
- 内嵌 view 注入与正文相同的 `generateStylesCss`（`src/lib/reader-styles.ts` 276–281 行）：`padding-inline`、`max-width: contentWidth em`、段间距和首行缩进。没有弹窗覆盖层。
- 定位：锚点是引用中心 x、底边 y，浮层 `left` 直接用该 x（左边缘对齐中心，不居中）。靠近视口底/右只夹取，不翻到引用上方。
- 内嵌 view 会自绘书页底色（深色主题 `html, body { background: #1a1a1a }`），和弹窗 `bg-popover` 叠成双层底。本仓库 foliate-js 没有 `no-background` 属性，不能走 readest 那条路。
- 既有关闭 / 链接 / 换书清理行为保持不变。不修改 `src/foliate-js/**`。

## Requirements

- R1 弹窗高度贴合脚注正文。短注不留大片空白；长注在视口上限内完整可读，超出部分在弹窗内滚动。
- R2 弹窗内排版按卡片处理：取消整页级左右边距、内容 `max-width`、首行缩进。字体 / 字号 / 行高 / 主题色跟随当前阅读器。
- R3 弹窗水平居中于被点的引用；默认出现在引用下方。下方空间不够且上方更宽时翻到上方，然后夹取在视口内，结果仍靠近引用。
- R4 内嵌 view 的 html/body 背景透明，弹窗只显示外壳 `bg-popover`，不再叠一层书页底色。
- R5 既有行为不变：点击外部或 Esc 关闭且阅读位置不变；非脚注链接不弹层；弹层内链接关闭后交主 view；换书 / 回书库无残留。

## Acceptance Criteria

- [ ] AC1 短脚注弹窗高度接近正文，没有接近占位 160px 或视口 60% 的空白。
- [ ] AC2 长脚注完整可读；超出视口上限的部分在弹窗内滚动，不裁切、不撑破视口。
- [ ] AC3 弹窗内无整页级左右边距和首行缩进；字体 / 字号 / 主题与当前阅读器一致。
- [ ] AC4 靠近页面底部的引用，弹窗出现在引用附近（上方或夹取后仍相邻），不会跑到视口顶部。
- [ ] AC5 弹窗内部底色与外壳一致，没有内嵌书页底色。
- [ ] AC6 关闭、非脚注链接、弹层内链接、换书清理行为不回归。
- [ ] AC7 `npm test` 与 `npm run build` 通过。

## Out of Scope

- 箭头 / 三角指示器、阴影等额外装饰。
- 按内容收缩宽度（保持现有约 `26rem`，视口变窄时仍 `max-w-[calc(100vw-1rem)]`）。
- 把 backdrop 从全窗口改成只盖阅读器。
- 弹层内链式浏览、历史栈、返回按钮。
- 非 reflowable（fixed-layout）EPUB 脚注。
- 脚注内编辑 / 标注 / TTS。
- 修改 `src/foliate-js/**`。

## Key Decisions

- MVP 取方案 A：高度 + 弹窗专用紧凑样式 + 贴着引用定位（居中、必要时上翻）+ 去掉双层底色。
- 高度读 foliate paginator 的 `renderer.viewSize`（排完后的内容尺寸），不用 `body.getBoundingClientRect()`。
- 紧凑样式是追加到 `generateStylesCss` 之后的覆盖层，不改主阅读器样式。
- 透明背景用 CSS 覆盖实现；本 submodule 没有 `no-background`。
