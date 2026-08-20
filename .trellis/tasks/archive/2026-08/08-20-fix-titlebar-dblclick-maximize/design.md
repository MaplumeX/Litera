# Design: 修复顶栏双击最大化竞态

## Architecture Overview

逻辑仍集中在 `src/components/WindowControls.tsx`。书库和阅读页继续共用同一套绑定，不另开 chrome 组件。

```
title / spacer
  pointerdown (button === 0, detail >= 2)
    → preventDefault + toggleMaximize(); 结束本次手势
  pointerdown (button === 0, detail < 2)
    → 记下起点；setPointerCapture
  pointermove
    → 未过阈值：不动
    → 过阈值且尚未拖：startDragging() 一次
  pointerup / pointercancel
    → 清手势
```

去掉这两个节点上的 `data-tauri-drag-region`。原生属性在第一次 `mousedown` 就会拖窗口，和双击无法共存。

## Data Flow / Contracts

1. **手势状态**  
   存在 hook 的 `useRef` 里，不进 React state。字段：`pointerId`、`startX`、`startY`、`dragging`。一次只有一个进行中的手势。

2. **双击（R1、R3）**  
   `button === 0` 且 `detail >= 2` → `preventDefault()` + `getCurrentWindow().toggleMaximize()`，立刻丢掉 session。不要等 `dblclick`：第二次 `pointerdown` 时必须先于任何 move 处理完，避免又走进拖动。

3. **拖动（R2）**  
   阈值 `TITLEBAR_DRAG_THRESHOLD_PX = 4`（约 Windows `SM_CXDRAG`）。比较 `dx² + dy²` 与 `4²`。过线后调用一次 `startDragging()`，把 `dragging` 置位。`startDragging` 失败忽略，与现有 `toggleMaximize` 的 `void` 风格一致。

4. **单击（R4）**  
   `detail < 2` 且从未过阈值：up 时只清 session。不 maximize、不 drag。

5. **绑定面（R5）**  
   导出 `useTitlebarWindowDrag()`，返回 `onPointerDown` / `onPointerMove` / `onPointerUp` / `onPointerCancel`。`LibraryView` 和 `App` 的标题、spacer 各展开这份 props。标题和 spacer 保留 `select-none`。用 `data-titlebar-drag` 标记这两个节点，方便测试找到它们；不要把该属性或指针处理绑到 header 根、搜索或按钮上。

6. **能力**  
   `core:window:allow-start-dragging` 和 `allow-toggle-maximize` 已经在 `src-tauri/capabilities/default.json`。不改 Rust，不改权限。

7. **最大化后拖出**  
   不在 JS 里 `unmaximize()`。`startDragging()` 在最大化窗口上的还原-再移动由 tao/Tauri 处理。

## Component Boundaries

- `WindowControls.tsx`：新增 hook、阈值常量、可单测的纯判定；删除 `onTitlebarDragMouseDown`。`WindowControls` 按钮、`titlebarClassName()` 不动。
- `LibraryView.tsx` / `App.tsx`：标题和 spacer 从 `data-tauri-drag-region` + `onMouseDown` 换成 hook props + `data-titlebar-drag`。
- 测试：`WindowControls.test.tsx` 覆盖双击 / 阈值 / 单击；书库和阅读页 chrome 测试把 `[data-tauri-drag-region]` 断言改成 `[data-titlebar-drag]`，双击改为 `pointerDown`。mock 增加 `startDragging`。
- 不改 `lib.rs`、capabilities、window-state、i18n。

## 关键权衡

- **移动阈值 vs 双击等待定时器**  
  定时器会让单击拖出现可感知延迟，而且 `setTimeout` 里调 `startDragging()` 可能丢掉用户手势。阈值不增加拖的手感：用户要拖本来就会动指针。选阈值。

- **去掉 `data-tauri-drag-region` vs 保留属性再补 JS**  
  属性在第一次按下就拖，这就是现网竞态。两者不能叠在同一节点上。`allow-start-dragging` 已具备。

- **hook vs 继续导出单个 mousedown 函数**  
  阈值拖需要 down/move/up。hook + pointer capture 能在指针离开节点后仍收到 move。模块级 session 在书库/阅读互切时也勉强能用，但 hook 边界更干净。

- **`button === 0` vs 旧的 `buttons === 1`**  
  `pointerdown` 上 `button` 表示刚按下的键；中键/右键不开始手势。

## Compatibility / Migration

- 无持久化、无新 i18n、无 Rust。
- 顶栏高度、Mac `pl-[72px]`、窗口按钮视觉保持不变。
- 现有测试里“title + spacer 带 `data-tauri-drag-region`”的约定一并改掉。Phase 3.3 再改 `.trellis/spec/frontend` 里对应句子。

## Rollback

纯前端。回滚 `WindowControls.tsx`、`LibraryView.tsx`、`App.tsx` 和相关测试即可。属性方案仍可用，只是竞态会回来。
