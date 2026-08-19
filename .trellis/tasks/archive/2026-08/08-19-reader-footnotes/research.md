# Research: FootnoteHandler 接入调研（2026-08-19）

## 1. foliate-js footnotes.js 机制（submodule, commit 78914ae）

`src/foliate-js/footnotes.js`（103 行）导出 `FootnoteHandler extends EventTarget`：

- **入口**：`handle(book, e)` — 接收 `book` 对象和 view 的 `link` CustomEvent。
  - `isFootnoteReference(a)`：`role="doc-noteref"` / `doc-biblioref` / `doc-glossref` 或 `epub:type="noteref"` 等 → 命中（`yes`）；否则 `detectFootnotes`（默认 true）下用上标启发式 `maybe()`。
  - 命中 → `e.preventDefault()`（阻止 view 默认 goTo）→ `book.resolveHref(href)` → `#showFragment`。
  - 未命中 → 返回 `undefined`，view 保持默认整页跳转（见下）。
- **渲染**：`#showFragment` 创建第二个 `<foliate-view>`，`view.open(book)` → `view.goTo(index)`，仅加载脚注所在章节并截取目标片段（`render` 事件 detail 携带 `target` 元素）。
- **事件**：
  - `before-render`：detail `{ view }` — 内嵌 view 已创建、即将打开 book。此时可挂载到浮层 DOM、注入样式。
  - `render`：detail `{ view, href, type, hidden, target }` — 内容就绪，定位 + 显示浮层。
- `#showFragment` 中 `hidden = el.matches('aside') && type === 'footnote'`（aside 脚注隐藏其余内容）。

## 2. view.js 的 link 事件（关键机制）

`src/foliate-js/view.js:350-365` `#handleLinks`：

```js
doc.addEventListener('click', e => {
  const a = e.target.closest('a[href]')
  if (!a) return
  e.preventDefault()                       // 阻止 iframe 内原生跳转
  ...
  Promise.resolve(this.#emit('link', { a, href }, true))
    .then(x => x ? this.goTo(href) : null) // emit 返回 false → 不跳转
})
```

- `#emit` 返回 `dispatchEvent(new CustomEvent(name, { detail, cancelable }))`。
- **listener 调 `e.preventDefault()` → dispatchEvent 返回 false → 主 view 不执行 goTo**。这是脚注拦截跳转的机制。
- `link` detail：`{ a: HTMLAnchorElement, href }`（href 已由 section.resolveHref 解析为绝对书内引用）。
- 应用层只需在主 view 元素上 `addEventListener('link', handler)`，未命中脚注时 handler 返回 undefined、不 preventDefault，**非脚注链接行为完全不变**（满足 R4）。

## 3. 位置计算

- `link` 事件 detail 里的 `a` 是 **iframe 内元素**。其 `getBoundingClientRect()` 是 iframe 内部坐标（整章 strip 的局部坐标，见 spec "iframe click X is chapter-strip local"），需叠加 `doc.defaultView.frameElement.getBoundingClientRect()` 偏移。
- 项目已有先例：`ReaderView.tsx` `selectionOverlayPos(doc, range)`（offset.left + rect.left 等）。
- 点击的引用元素（`a`）坐标 + 元素高度即可作为浮层锚点。浮层用 `fixed` 定位（与 SelectionToolbar 相同的模式：`fixed z-50` + left/top 样式），不依赖 Radix Popover 的 anchor 机制（anchor 是 iframe 外元素，Radix anchor 无法指向 iframe 内部节点）。

## 4. 样式注入

- 主 view：`App` → `readerRef.setStyles(generateStylesCss(styleState))` → `view.renderer.setStyles(css)`（spec "Inject font/theme CSS via view.renderer.setStyles"）。
- 内嵌脚注 view 是**独立的 foliate-view**，不会继承主 view 样式。需在 `before-render` 时给内嵌 view 也 `renderer.setStyles`，否则脚注内容无字体/主题适配。
- 方案：`ReaderView` 新增可选 prop `stylesCss?: string`；`App` 在 styleState 变化时（`setStyles` 调用处，App.tsx:325/553）一并传入；ReaderView 在 before-render 挂载内嵌 view 时应用。
- 注意：`setStyles` 每次替换整个样式表；内嵌 view 只需注入一次（其内容固定），主 view 仍走原有 handle。

## 5. 参考实现（readest FootnotePopup.tsx, 399 行）

- `new FootnoteHandler()` 常驻；主 view `link` 事件 → `footnoteHandler.handle(bookDoc, e)?.catch(...)`。
- `before-render`：内嵌 view 挂入浮层容器；给内嵌 view 加 `link` 监听（脚注内链接处理）；`renderer.setAttribute('flow', 'scrolled')` + `no-preload` + 零边距；`renderer.setStyles(main + footnote)`。
- `render`：`view.addEventListener('relocate')` 里测内容尺寸后显示浮层。
- 关闭：`Overlay` 点击关闭 + Esc；浮层内链接 → 关闭浮层交主 view。
- 本项目采用其简化版（无历史栈/返回按钮，方案 1 已确认）。

## 6. 本项目集成点

- `ReaderView.tsx` 挂载 effect（279-480 行）中已有 relocate/create-overlay/draw-annotation/load 监听，新增 `link` 监听 + FootnoteHandler 生命周期。
- book 对象：open 成功后 `view.book` 可用（含 `resolveHref` / `isExternal`，需补 d.ts 类型）。
- 浮层：新组件 `FootnotePopup.tsx`（fixed 定位容器 + backdrop 点击关闭 + Esc），与 SelectionToolbar/TOC drawer 的现有模式一致。
- 关闭浮层后主 view 跳转：`view.goTo(href)`（backlink 亦走此路径回到正文引用处）。

## 7. 类型声明（src/foliate-js.d.ts）

现有 d.ts 未声明：`Book.resolveHref` / `Book.isExternal`、`footnotes.js` 模块、`link` 事件。需补充（spec type-safety.md 允许扩展 foliate.js typing）。
