# Implement: 阅读器脚注功能

## 实现顺序（依赖排序）

1. **`src/foliate-js.d.ts`** — 补充类型声明（Book.resolveHref/isExternal、footnotes.js 模块、link 事件）。后续所有代码的类型基础。
2. **`FootnotePopup.tsx`**（新组件）— 浮层 UI + 内嵌 view 挂载 + 关闭逻辑。纯展示组件,不依赖 ReaderView。
3. **`ReaderView.tsx`** — 接入 FootnoteHandler:link 监听、before-render/render 处理、浮层状态、stylesCss prop。
4. **`App.tsx`** — 传递 `stylesCss={generateStylesCss(...)}`(在现有两处 setStyles 调用点同步)。
5. **测试** — FootnotePopup 单元测试 + ReaderView 相关行为测试(如可行)。

## 检查清单

### Step 1: foliate-js.d.ts
- [ ] `Book` 接口增补 `resolveHref` / `isExternal`(按 research.md 第 7 节签名)。
- [ ] 新增 `declare module "*/foliate-js/footnotes.js"`,声明 `FootnoteHandler extends EventTarget`:`handle(book, e): Promise<unknown> | undefined`、`detectFootnotes: boolean`。
- [ ] `View` 声明不破坏现有使用(foliate-js.d.ts 是 ambient 声明,只增不改)。

### Step 2: FootnotePopup.tsx
- [ ] 组件接口:`{ x, y, viewElement, stylesCss?, onClose }`;`fixed` 定位(参照 SelectionToolbar)。
- [ ] backdrop(`fixed inset-0`,点击关闭)+ 浮层容器(`fixed z-50`,宽高限制 + 视口内夹取)。
- [ ] Esc 关闭(window keydown 监听,打开期间绑定、关闭时解绑)。
- [ ] 关闭回调时清理内嵌 view(`close?.()` + `remove()`)——清理逻辑由调用方(ReaderView)或组件自身负责,保持一致。
- [ ] 浮层容器内挂载传入的 `<foliate-view>` 元素。

### Step 3: ReaderView.tsx
- [ ] 新增 prop `stylesCss?: string`(ReaderViewProps 接口)。
- [ ] 挂载 effect(279-480 行区域)中:
  - [ ] 创建 `FootnoteHandler` 实例(与 view 元素同生命周期);
  - [ ] `el.addEventListener("link", handler)` — handler 中 `handler.handle(view.book, e)`,命中时记录位置与内嵌 view,未命中不 preventDefault;
  - [ ] `before-render`:内嵌 view 挂入浮层容器 + `renderer.setStyles(stylesCss)` + `renderer.setAttribute('flow', 'scrolled')`(滚动画卷模式展示脚注内容);
  - [ ] `render`:读取 `target` 元素坐标(叠加 frameElement 偏移,参照 `selectionOverlayPos`)→ 设置浮层位置状态;
  - [ ] 清理:effect cleanup 中 `footnoteHandler` 相关监听与内嵌 view close。
- [ ] 浮层内链接:内嵌 view 的 `link` 事件 → 关闭浮层 → `el.goTo(href)`(主 view)。
- [ ] 打开书籍(fileData 变化)时重置浮层状态。
- [ ] 浮层 JSX:`{footnoteOpen && <FootnotePopup ... />}` 渲染在 ReaderView 根容器内。

### Step 4: App.tsx
- [ ] 两处 `setStyles` 调用(App.tsx:325、553)同步:ReaderView 传 `stylesCss={generateStylesCss({ ...styleState, theme: resolvedTheme })}`。注意 styleState 与 resolvedTheme 的当前值传递方式,避免重复计算或依赖遗漏。

### Step 5: 测试与验证
- [ ] 新增 `FootnotePopup.test.tsx`(参照 SelectionToolbar.test.tsx 风格):渲染/关闭回调/Esc。
- [ ] `npm test` 全部通过(含既有测试不回归)。
- [ ] `npm run build`(tsc + vite build)通过。
- [ ] 手动验证(如有 Tauri 环境):打开含脚注 EPUB,逐条核对 AC1-AC6。

## 验证命令

```bash
cd /home/maplume/.paseo/worktrees/1hwu268q/prime-hyena
npm test          # vitest 全量
npm run build     # tsc + vite build(类型检查是硬门槛)
npx vitest run src/components/FootnotePopup.test.tsx   # 单文件快速迭代
```

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚方式 |
|---|---|---|
| `src/components/ReaderView.tsx` | 主阅读器核心;挂载 effect 改动影响所有书籍 | git 还原单文件 |
| `src/foliate-js.d.ts` | ambient 声明,错误类型影响全局编译 | git 还原单文件 |
| `src/components/FootnotePopup.tsx` | 新组件,无既有依赖 | 删除文件 |
| `src/App.tsx` | 仅加 prop,一行级改动 | git 还原单文件 |

## 遵循规范

- 不修改 `src/foliate-js/**`(submodule)。
- 不引入第三方库(浮层用现有 UI 模式)。
- 新组件遵循 component-guidelines:icon/按钮规范、`cn()`、`useT()`(如需要文案)。
- 类型遵循 type-safety.md:组件局部类型内联,ambient 声明只增不改。
- 测试风格参照现有组件测试(SelectionToolbar.test.tsx / TocSidebar.test.tsx)。

## Follow-up checks（task.py start 前）

- [ ] prd.md / design.md / implement.md 已齐备。
- [ ] implement.jsonl / check.jsonl 已填充真实条目(删除 _example 行)。
- [ ] 规划摘要已向用户呈现并获得批准。
