# Design: 阅读器脚注功能

## Architecture Overview

```
App.tsx ──stylesCss prop──► ReaderView ──link 事件──► FootnoteHandler (foliate-js/footnotes.js)
                              │                            │
                              │                      before-render / render 事件
                              ▼                            ▼
                    FootnotePopup.tsx (新组件, fixed 定位浮层)
                              │
                        内嵌 <foliate-view> 挂载点 + backdrop/Esc 关闭
```

- 主 view 元素(`<foliate-view>`)由 ReaderView 持有;在其上监听 foliate 的 `link` 事件。
- `FootnoteHandler.handle(book, event)`:命中脚注 → `preventDefault`(dispatchEvent 返回 false,主 view 不 goTo)→ 创建内嵌 view 渲染脚注片段 → 派发 `before-render` / `render`。
- 未命中 → handler 返回 undefined,主 view 走默认 `goTo(href)`,非脚注链接行为不变(R4)。
- 浮层是 ReaderView 内部渲染的 React 节点(`fixed` 定位 + backdrop),不依赖 Radix Popover 的 anchor(anchor 无法指向 iframe 内部节点)。

## Data Flow / Contracts

1. **`link` 事件**(foliate view.js:353-365):detail `{ a: HTMLAnchorElement, href: string }`,cancelable。listener 未 preventDefault 时 view 自动 `goTo(href)`。
2. **`FootnoteHandler.handle(book, e)`**(footnotes.js):返回 `Promise | undefined`;命中时派发 `before-render`(detail `{ view }`)与 `render`(detail `{ view, href, type, hidden, target }`)。
3. **内嵌 view 样式**:`before-render` 中挂载内嵌 view 到浮层 DOM 并调用 `view.renderer.setStyles(stylesCss)`;样式字符串由 App 传入 ReaderView 新 prop `stylesCss?: string`(复用 `generateStylesCss` 输出,App.tsx:324/553 已有调用点)。
4. **位置**:`render` 事件的 `target` 元素(`getBoundingClientRect`,章节 strip 局部坐标)→ 叠加 `target.ownerDocument.defaultView.frameElement.getBoundingClientRect()` 偏移 → `fixed` 定位浮层(参照 `selectionOverlayPos`,ReaderView.tsx)。
5. **关闭**:backdrop 点击 / Esc → 卸载浮层、`innerView.close?.()` + `remove()`,主 view 位置不变。
6. **浮层内链接**:内嵌 view 自身也派发 `link` 事件;handler 中关闭浮层,然后 `mainView.goTo(href)`(backlink 同理,跳回正文引用处)。外部链接走 foliate `external-link`(主 view 默认 `window.open`)。

## Component Boundaries

- `ReaderView.tsx`(改):
  - 新增 prop `stylesCss?: string`(可选,兼容现有调用方)。
  - 挂载 effect 中新增 `link` 事件监听 → `footnoteHandler.handle(view.book, e)`;新增 `FootnoteHandler` 生命周期(与 view 元素同生共死,`close()` 时清理)。
  - 新增 `footnoteOpen` / `footnoteContent`(位置 + 内嵌 view 引用)状态,渲染 `<FootnotePopup>`。
- `FootnotePopup.tsx`(新,`src/components/`):
  - props: 锚点坐标、内嵌 view 元素(由 before-render 挂入容器)、关闭回调、stylesCss。
  - 渲染:backdrop(fixed inset-0 z-40)+ 浮层容器(fixed z-50,参照 SelectionToolbar 模式)。
  - Esc 关闭(监听 window keydown,仅在打开时);关闭时清理内嵌 view。
  - 浮层内 link 事件处理(关闭浮层 → 主 view goTo)。
- `src/foliate-js.d.ts`(改):
  - `Book` 增补 `resolveHref?(href: string): { index: number; anchor: (doc: Document) => Element }`、`isExternal?(href: string): boolean`。
  - 新增 `declare module "*/foliate-js/footnotes.js"`:`FootnoteHandler` 类(eventTarget + handle + detectFootnotes)。
  - view.js 模块增补 `link` / `external-link` 事件说明(类型上以 CustomEvent detail 形式使用)。

## 关键权衡

- **固定定位浮层 vs Radix Popover**:Radix 的 anchor 基于 iframe 外 DOM 节点,无法以 iframe 内部引用元素为锚;固定定位 + 手算坐标与 SelectionToolbar 先例一致。代价:无自动避让,浮层贴边时由定位逻辑夹取在视口内。
- **独立内嵌 view 渲染 vs 提取纯文本**:内嵌 view 保留原书样式与排版(引用/链接可继续交互),代价是每次打开脚注创建/销毁一个 view(与 readest 一致)。
- **方案 1 简化**(R5):浮层内链接一律关闭浮层交主 view,无历史栈。相比 readest 完整版少一个返回按钮与导航栈,复杂度显著降低,覆盖绝大多数阅读场景。
- **不编辑 submodule**:footnotes.js 的 `maybe()` 上标启发式已默认开启,`handle()` 未命中即回退默认行为,无需打补丁。

## Compatibility / Migration

- 无持久化数据变更;无 Rust 侧改动;无 preferences.json 改动。
- `stylesCss` 为可选 prop,不传时浮层用 foliate 默认样式(仍可读)。
- 固定布局(fixed-layout)EPUB 不支持 `setStyles` 且脚注语义少见,MVP 仅覆盖 reflowable,不做特殊处理。

## Rollback

- 纯前端新增 + 可选 prop 改动;回滚即还原 ReaderView/App 调用点与删除 FootnotePopup 组件,不涉及数据迁移。
- 风险点:内嵌 view 的 `close()` 时序(重复快速点击)、浮层定位在分栏/多页章节下的坐标偏移;均在实现后通过手动验证 + 单元测试覆盖。
