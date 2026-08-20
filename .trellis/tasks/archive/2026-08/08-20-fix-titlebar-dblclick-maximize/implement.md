# Implement: 修复顶栏双击最大化竞态

## 实现顺序

1. **`src/components/WindowControls.tsx`**
   - 删除 `onTitlebarDragMouseDown`。
   - 导出 `TITLEBAR_DRAG_THRESHOLD_PX = 4`、`shouldStartTitlebarDrag(dx, dy)`、`useTitlebarWindowDrag()`。
   - hook 按 design 处理 pointerdown / move / up / cancel；`detail >= 2` 时 `toggleMaximize()` 且不 `startDragging()`。
   - `WindowControls` 和 `titlebarClassName()` 不改。
2. **`src/components/LibraryView.tsx` 与 `src/App.tsx`**
   - 各调一次 hook，把返回的 pointer props 绑到标题和 spacer。
   - 去掉这两处的 `data-tauri-drag-region` 和 `onMouseDown={onTitlebarDragMouseDown}`。
   - 标题和 spacer 加 `data-titlebar-drag`，保留 `select-none`。
3. **测试**
   - mock `startDragging`。
   - 双击：`pointerDown` `button: 0` `detail: 2` → `toggleMaximize` 一次，无 `startDragging`。
   - 单击 down + 移动超过 4px → `startDragging` 一次；移动 1px → 不拖、不 maximize。
   - 双击之后的 move 不再 `startDragging`。
   - 书库 / 阅读页：`[data-titlebar-drag]` 长度为 2；搜索和按钮没有该属性；spacer 双击仍 maximize。

## 检查清单

- [ ] 可拖节点上没有 `data-tauri-drag-region`。
- [ ] 第一次 `pointerdown`（`detail < 2`）不调用 `startDragging` 或 `toggleMaximize`。
- [ ] `startDragging` 每个手势最多一次。
- [ ] 非主键 down 忽略。
- [ ] header 根、搜索、窗口按钮、阅读页工具按钮都不绑拖动手势。
- [ ] 关闭按钮仍是 `close()`。
- [ ] 不改 Rust、capabilities、i18n、window-state。

## 验证命令

```bash
npx vitest run src/components/WindowControls.test.tsx src/components/LibraryView.test.tsx src/App.annotations.test.tsx src/App.reader-mode.test.tsx
npm test
npm run build
```

手动（AC7）：`npm run tauri dev`，书库和阅读页各试双击顶栏空白、按住拖动、点搜索/按钮。

## 风险文件 / 回滚点

| 文件 | 风险 | 回滚 |
|---|---|---|
| `src/components/WindowControls.tsx` | 手势状态 / hook API | 还原 `onTitlebarDragMouseDown` + 属性方案 |
| `src/components/LibraryView.tsx` | 书库顶栏拖不动或抢走搜索点击 | 还原属性 + `onMouseDown` |
| `src/App.tsx` | 阅读页顶栏同上 | 还原属性 + `onMouseDown` |

## 遵循规范

- 继续用 `WindowControls.tsx` 里的共享 helper，不要在书库/阅读页各写一套。
- 不要把拖动手势绑到 header 根上。
- 不要为这次修复加 `@tauri-apps/plugin-os` 或新 Rust 命令。
- Spec 更新（`quality-guidelines.md` / `component-guidelines.md` 里 `data-tauri-drag-region` + `detail === 2` 的句子）留到 Phase 3.3，实现提交前不要抢改。

## Follow-up checks（task.py start 前）

- [x] prd.md / design.md / implement.md 已齐备。
- [x] implement.jsonl / check.jsonl 有真实条目。
- [ ] 规划摘要已向用户呈现并获得批准。
