# Design: 修复 Windows 顶栏双击最大化失效

## Architecture Overview

改动集中在 `src/components/WindowControls.tsx` 的 `useTitlebarWindowDrag` hook。不新增文件，不改 Rust，不改权限。

## Root Cause

Windows WebView2 中，Chromium 的 pointer event 管线在第一次 `pointerdown` 时如果调了 `setPointerCapture()`，可能导致第二次点击的 `pointerdown` 事件 `detail` 值不是 2（与 pointer capture 释放时序相关，Chromium issue #40675080）。

当前代码依赖 `event.detail >= 2` 判定双击：
```ts
if (event.detail >= 2) {
  event.preventDefault();
  void getCurrentWindow().toggleMaximize();
  return;
}
```

当 `detail` 始终为 1 时，双击分支永远不会执行 → 双击完全无反应。

## Fix Approach

不再依赖 `event.detail`，改为**自行跟踪双击**：

```
pointerdown (button === 0)
  ├─ 距上次 pointerdown < 500ms 且距离 < 10px
  │   → preventDefault() + toggleMaximize()，清除双击计时
  └─ 否则
      → 记录本次 pointerdown 时间和坐标
      → 记 startX/startY，setPointerCapture
pointermove → 阈值 > 4px → startDragging() 一次
pointerup/pointercancel → 清手势
```

关键改动：用 `Date.now()` 时间差 + `clientX/clientY` 距离差来判定双击，不依赖 `event.detail`。

### 双击参数

- **时间窗口**: 500ms（Windows 默认双击间隔）
- **距离阈值**: 10px（允许双击时轻微手抖）

## Data Flow / Contracts

1. **手势状态**（不变）
   - `useRef` 存 `pointerId`, `startX`, `startY`, `dragging`

2. **双击跟踪**（新增）
   - `useRef` 存 `lastDownTime: number`, `lastDownX: number`, `lastDownY: number`
   - 每次 `pointerdown` 比较当前与上次的时间/距离

3. **双击判定**
   ```ts
   const now = Date.now();
   const dt = now - lastDownTime;
   const dx = event.clientX - lastDownX;
   const dy = event.clientY - lastDownY;
   const isDoubleClick = dt < 500 && dx * dx + dy * dy < 100; // 10px²
   ```

4. **setPointerCapture 保留**
   - 单击拖动仍需要 pointer capture（指针移出元素后继续收到 move 事件）
   - pointer capture 不影响我们自建的的双击追踪

5. **`event.preventDefault()` 保留**
   - 双击时防止文本选中等默认行为

## Component Boundaries

- `WindowControls.tsx`：修改 `useTitlebarWindowDrag`，新增双击追踪 ref 和判定逻辑
- `WindowControls.test.tsx`：更新双击测试用例（模拟真实 Windows 场景：两次 pointerdown `detail` 均为 1）
- `LibraryView.tsx` / `App.tsx`：不改（hook 接口不变）

## 关键权衡

- **自建双击追踪 vs 用 `dblclick` 事件**
  `dblclick` 事件在 pointer capture 激活时可能不触发。`pointerdown` 时间差判定更可靠。

- **500ms + 10px vs 更严格/更宽松的参数**
  对齐 Windows 系统默认值。更短会漏判手慢用户，更长会误判快速单击。

- **保留 `setPointerCapture` vs 去掉**
  单击拖动需要它。pointer capture 与自建双击追踪无冲突。

## Compatibility / Migration

- 无持久化、无新 i18n、无 Rust 改动
- macOS / Linux 行为不变（`detail` 判定 → 时间差判定，在这两个平台效果等价）
- 现有测试需更新：双击测试改为两次 `pointerDown`（模拟 `detail: 1`）

## Rollback

纯前端单文件修改，回滚 `WindowControls.tsx` 和 `WindowControls.test.tsx` 即可。
