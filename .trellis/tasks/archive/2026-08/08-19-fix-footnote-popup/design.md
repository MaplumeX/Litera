# Design: 修复脚注弹窗高度、样式与定位

## Architecture Overview

改动仍落在现有弹层路径上，不新增组件、不改 foliate-js submodule。

```
ReaderView  link 命中
  → 记下锚点 (引用中心 x, 底边 y)
  → before-render: 挂内嵌 view, flow=scrolled, margin=0,
                   setStyles(stylesCss + footnotePopupCss())
  → relocate: height = renderer.viewSize
FootnotePopup
  → 用锚点 + 实测宽高计算盒子：水平居中，优先下方，必要时上翻，再夹取
```

## Data Flow / Contracts

1. **高度（R1）**
   - `relocate` 时读 `inner.renderer.viewSize`（paginator.js:778，scrolled 模式下是内容展开后的 iframe 高度）。
   - `viewSize <= 0` 时回退 `body.getBoundingClientRect().height`。
   - `FootnotePopup` 仍用 `Math.min(height, innerHeight * 0.6)` 做上限。占位高度可保留，仅在 `height == null` 时使用。
   - 只在取整后的高度变化时 `setFootnoteHeight`，避免 paginator `ResizeObserver` → `expand()` 循环。
   - `FoliateRenderer` / `FoliateInnerView.renderer` 补 `viewSize?: number`。

2. **紧凑样式（R2）**
   - 新增 `footnotePopupCss()`，放在 `src/lib/reader-styles.ts`，与 `generateStylesCss` 并列。
   - 覆盖层必须跟在 `generateStylesCss` 后面，才能压过页边距 / `max-width` / 首行缩进 / 主题背景：
     - `html, body`：`background: transparent !important`、`min-height: 0`、`height: auto`、`max-width: none`、`margin-inline: 0`、紧凑 `padding`（约 `0.75rem`）。
     - `p`：`text-indent: 0 !important`，段间距收到约 `0.5em`。
   - 不改 `generateStylesCss` 本身。主 view 的 `setStyles` 路径不动。
   - 内嵌 view：`setStyles(\`${stylesCss}\n${footnotePopupCss()}\`)`。`stylesCss` 为空时只注入覆盖层（字体退回书/浏览器默认，但卡片约束仍在）。

3. **定位（R3）**
   - 抽出纯函数（与 `FootnotePopup` 同文件或紧邻），输入：锚点 `(x, y)`、盒子宽高、视口宽高、边距/间隙常数。
   - 水平：`left = x - width / 2`，再夹到 `[margin, vw - margin - width]`。
   - 垂直：默认 `top = y + GAP`。若下方放不下且上方空间更大，则 `top = y - GAP - height`。最后夹到视口。
   - `useLayoutEffect` 在 `x/y/height/viewElement` 变化后用 `getBoundingClientRect()` 的实测宽高调用该函数。锚点语义不变：引用中心 x、底边 y。

4. **透明背景（R4）**
   - 本 submodule 无 `no-background`（paginator 未实现该 attribute）。
   - 覆盖层把 `html, body` 背景设为透明后，paginator `getBackground` 会落到透明，`#background` 不再刷书页色。
   - 内嵌 `foliate-view` 元素也设 `background: transparent`，减少 iframe 默认白底。
   - 弹窗外壳继续用 `bg-popover`。深色主题的文字色仍来自 `generateStylesCss` 的 `color`。

## Component Boundaries

- `src/lib/reader-styles.ts`：新增 `footnotePopupCss()`；`generateStylesCss` 不改签名、不改输出。
- `src/components/ReaderView.tsx`：高度改为 `viewSize`；`setStyles` 追加覆盖层；内嵌 view 背景透明。关闭 / 竞态 / 链接委托不改。
- `src/components/FootnotePopup.tsx`：定位改为居中 + 上翻 + 夹取。宽度、backdrop、Esc、always-mounted 挂载点不改。
- `src/foliate-js.d.ts`：`FoliateRenderer` 增加 `viewSize?: number`、`setAttribute?`（已有 HTMLElement 路径则只补 viewSize）。
- 测试：`footnotePopupCss` 单元测试；定位纯函数单元测试（底部锚点上翻、右边缘夹取、水平居中）；现有 FootnotePopup 开关/Esc 测试保持。

## 关键权衡

- **`viewSize` vs body 高度**：`viewSize` 是 paginator 展开后的内容尺寸，和 scrolled 布局一致。body 高度会被 `min-height: 100%` 和占位 160px 污染。覆盖层去掉 `min-height` 后 `viewSize` 才稳定。
- **覆盖层 vs 改 `generateStylesCss`**：主阅读器必须保留页边距和缩进。覆盖层只给内嵌 view 追加，边界清晰。
- **CSS 透明 vs 打 submodule 补丁**：readest 用 `no-background`，我们的 paginator 没有该属性。CSS 覆盖零 submodule 风险。
- **纯函数定位 vs 写在 effect 里**：翻转和夹取有多种边界，纯函数可单测，避免只靠 jsdom 的 `getBoundingClientRect`。

## Compatibility / Migration

- 无持久化、无 Rust、无 i18n 新键。
- 主阅读器 `setStyles` 调用链不变。
- 弹窗宽度、z-index、关闭手势、脚注命中规则不变。

## Rollback

纯前端。回滚 `reader-styles.ts`、`ReaderView.tsx`、`FootnotePopup.tsx`、`foliate-js.d.ts` 及相关测试即可。
