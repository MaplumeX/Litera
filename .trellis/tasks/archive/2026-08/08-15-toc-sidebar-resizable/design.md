# Design: TOC sidebar resizable width

## Context

目录抽屉在 `App.tsx` 的 reader 视图中渲染：

```tsx
{tocVisible && (
  <>
    <button ... onClick={() => setTocVisible(false)} />  {/* 遮罩 */}
    <div className="absolute inset-y-0 left-0 z-30 w-56 overflow-hidden border-r bg-background shadow-md">
      <TocSidebar toc={toc} onGoTo={handleTocGoTo} />
    </div>
  </>
)}
```

宽度 `w-56`（224px）硬编码在 App.tsx。`TocSidebar` 内部是 `w-full`，不感知宽度。

## Approach

### 1. 宽度状态（App.tsx）

新增 `tocWidth` state，初始值从 localStorage 读取，无保存值时用 224：

```ts
const TOC_WIDTH_KEY = "toc-sidebar-width";
const TOC_WIDTH_DEFAULT = 224;
const TOC_WIDTH_MIN = 160;
```

读取/写入封装成小工具函数（放 `src/lib/` 或直接内联在 App.tsx）。参考 `src/lib/i18n.ts` 的 localStorage 用法（`typeof localStorage === "undefined"` 守卫）。

### 2. 拖拽手柄（App.tsx 抽屉容器内）

在抽屉 `div` 右侧边缘加一个绝对定位的拖拽条：

```tsx
<div
  className="absolute inset-y-0 -right-1 z-40 w-1.5 cursor-col-resize bg-transparent hover:bg-primary/30"
  onPointerDown={startTocResize}
  role="separator"
  aria-orientation="vertical"
/>
```

拖拽逻辑用 pointer events（与 react-resizable-panels 一致，避免 mouse 事件在 iframe 上的问题）：

- `onPointerDown`：`setPointerCapture`，记录起始 X 和起始宽度。
- `onPointerMove`（在 window 上监听，或利用 pointer capture）：`width = startWidth + (e.clientX - startX)`，钳制到 `[160, 容器宽度]`。
- `onPointerUp`：结束拖拽，把最终宽度写入 localStorage。

容器宽度上限：用抽屉父容器（reader Panel 的 `div.relative`）的 `clientWidth` 作为上限，或简单用 `window.innerWidth` 的百分比。更稳妥：拖拽时读取父容器 `getBoundingClientRect().width` 作为 max。

实现方式选择：在 App.tsx 内用 `useRef` + `useState` + 少量 effect 完成，不引入新依赖。拖拽期间用 `document.body.style.cursor` / `user-select` 防止文本选中（或依赖 pointer capture + `touch-action: none`）。

### 3. 抽屉宽度应用

```tsx
<div
  className="absolute inset-y-0 left-0 z-30 overflow-hidden border-r bg-background shadow-md"
  style={{ width: tocWidth }}
>
```

去掉 `w-56`，改用内联 `width`。`TocSidebar` 内部不变（`w-full` 自适应）。

### 4. 持久化

- key：`toc-sidebar-width`（与 i18n 的 `LOCALE_STORAGE_KEY` 风格一致，全小写连字符）。
- 存数字（px），`localStorage.setItem(key, String(width))`。
- 读取时 `Number.parseInt` + 校验（NaN / 越界回退默认值）。
- 只在拖拽结束（pointerup）时写，避免拖拽过程中频繁写。

## Tradeoffs

- **为什么不用 react-resizable-panels 的 Separator**：抽屉是 overlay（绝对定位），不是 Group 的 Panel，Separator 无法直接复用；且引入 Group 会改变现有交互结构。自实现 pointer 拖拽约 30 行，可控。
- **为什么用 pointer events 而非 mouse events**：与库内实现一致，天然支持触摸，且配合 `setPointerCapture` 可避免拖出抽屉后丢失事件。
- **上限用父容器宽度**：保证抽屉永不溢出阅读器区域，符合 R1。

## Compatibility

- 无 schema / 持久化协议变更，仅新增一个 localStorage key。
- 不影响批注抽屉、AI 对话面板。
- 不影响 Tauri 侧（纯前端改动）。
