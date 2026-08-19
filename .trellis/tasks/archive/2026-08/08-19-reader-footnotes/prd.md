# 阅读器脚注功能

## Goal

点击 EPUB 中的脚注引用时,在当前阅读位置附近弹出脚注内容(原地弹层),不离开当前页;关闭后回到原文。

## Background / 已确认事实（代码调研）

- 阅读器基于 foliate-js（git submodule，`src/foliate-js`，commit 78914ae）的 `<foliate-view>` 自定义元素渲染 EPUB。
- foliate-js 自带 `src/foliate-js/footnotes.js`（103 行），导出 `FootnoteHandler` 类：
  - 监听 view 的 `link` 事件，`isFootnoteReference(a)` 通过 `role="doc-noteref"` / `epub:type="noteref"` 或上标启发式判断脚注引用；
  - 命中时 `e.preventDefault()`，用内嵌 `foliate-view` 加载脚注目标片段，派发 `before-render`（可拿到内嵌 view 挂载到弹层）和 `render`（携带目标元素）事件；
  - `detectFootnotes` 属性默认为 true（上标启发式检测）。
  - 但该文件目前没有被任何模块引用（view.js / epub.js / reader.html 均无引用），需要应用层自行接入。
- 当前行为（无脚注功能）：ReaderView.tsx 未监听 `link` 事件，点击脚注引用走 foliate `view.js` `#handleLinks` 默认逻辑 → `goTo(href)` 整页跳转（`src/foliate-js/view.js:353-365`），无返回机制、无弹层。
- 项目已有 UI 组件 `src/components/ui/popover.tsx` 可复用；SelectionToolbar 使用 `fixed z-50` + left/top 定位（`src/components/SelectionToolbar.tsx`）。
- 参考实现：readest 项目 `FootnotePopup.tsx`（React + foliate-js，399 行）——监听 view `link` 事件 → `footnoteHandler.handle()` → `before-render` 把内嵌 view 挂入 popup → `render` 定位并显示；支持脚注内链接历史栈与返回按钮。
- ReaderView.tsx 现有结构：`useEffect` 中创建 `<foliate-view>` 元素并绑定 relocate/create-overlay/draw-annotation/load 等事件（ReaderView.tsx:279-480）。
- `view.renderer.setStyles` 每次替换整个样式表（spec "Inject font/theme CSS via view.renderer.setStyles"）；内嵌脚注 view 是独立 foliate-view，不会继承主 view 样式，需单独注入。
- `link` 事件 detail 的 `a` 是 iframe 内元素，其 `getBoundingClientRect()` 是章节 strip 局部坐标，需叠加 `frameElement` 偏移（`selectionOverlayPos` 已有先例，ReaderView.tsx）。

## Requirements

- R1 点击脚注引用(`role="doc-noteref"` / `epub:type="noteref"` 或上标启发式)时,不再整页跳转,而是在引用位置附近弹出脚注内容。
- R2 弹层内容从原书脚注目标加载(带书内样式与用户字体/主题)。
- R3 弹层可关闭(点击外部 / Esc),关闭后阅读位置不变。
- R4 非脚注的书内链接保持现有跳转行为不变。
- R5 弹层内点击任何链接(backlink / 交叉引用 / 外部链接):关闭弹层,由主阅读器按普通链接处理(backlink 关闭弹层回到原文;其他链接在主 view 正常跳转)。无历史栈、无返回按钮。
- R6 切换书籍/返回书库时,清理脚注弹层及其内嵌 view,不留残留。
- R7 弹层位置由点击的脚注引用元素坐标计算(fixed 定位,参照 SelectionToolbar),视口边缘时夹取在可视范围内。

## Acceptance Criteria

- [ ] AC1 打开含脚注的 EPUB,点击脚注引用:不翻页、不跳转,引用附近弹出脚注内容浮层。
- [ ] AC2 浮层内显示脚注全文,样式(字体/字号/主题)与主阅读器一致。
- [ ] AC3 点击浮层外区域或按 Esc,浮层关闭,阅读位置保持不变(仍停留在原章节原位置)。
- [ ] AC4 点击普通书内链接(非脚注),行为与改动前一致(正常跳转),不弹浮层。
- [ ] AC5 在浮层内点击链接:浮层关闭,主阅读器按该链接正常跳转。
- [ ] AC6 返回书库 / 打开另一本书后,无残留浮层或内嵌 view;重复点击同一脚注可再次弹出。
- [ ] AC7 `npm run build`（tsc + vite build）与 `npm test` 全部通过。

## Out of Scope

- 弹层内链式浏览(脚注中再点脚注、历史栈、返回按钮)——readest 完整版,已确认不做。
- 非 reflowable(fixed-layout)EPUB 的脚注。
- 脚注内容编辑 / 标注 / TTS 朗读。
- 修改 `src/foliate-js/**`(submodule 不可编辑)。
