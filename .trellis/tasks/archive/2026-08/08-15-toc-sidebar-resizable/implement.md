# Implement: TOC sidebar resizable width

## Checklist

- [ ] 1. 在 `src/lib/` 新增 `toc-sidebar-width.ts`（或等价位置）：`TOC_WIDTH_KEY`、`TOC_WIDTH_DEFAULT`、`TOC_WIDTH_MIN`、`loadTocWidth()`、`saveTocWidth()`，含 localStorage 守卫与 NaN/越界回退。
- [ ] 2. `App.tsx`：新增 `tocWidth` state（初始值 `loadTocWidth()`）；抽屉 `div` 去掉 `w-56`，改用 `style={{ width: tocWidth }}`。
- [ ] 3. `App.tsx`：抽屉容器内新增拖拽手柄（绝对定位右侧、`cursor-col-resize`、hover 反馈），实现 pointer 拖拽：pointerdown 记录起点 → pointermove 实时更新宽度（钳制 [MIN, 父容器宽]）→ pointerup 保存。
- [ ] 4. 新增测试 `src/components/TocSidebar.test.tsx`（或针对宽度逻辑的测试文件）：
  - 拖拽手柄存在且可交互（pointerdown/move/up 后宽度变化）。
  - 宽度钳制在 [160, 容器宽]。
  - localStorage 读写（保存后 reload 恢复；无保存值时用默认 224）。
- [ ] 5. 验证：`npm test` 全过、`npm run build` 通过。
- [ ] 6. 手动验证（如可运行）：打开目录 → 拖拽 → 关闭重开 → 重启后宽度保持。

## Validation Commands

```bash
npm test
npm run build
```

## Review Gates

- 拖拽手柄 hover 视觉反馈与 AI 对话面板 Separator 风格一致。
- 宽度不溢出窗口；窄宽度下目录项 `truncate` 正常。
- 批注抽屉、AI 对话面板行为无回归。

## Rollback

- 纯前端改动，单 commit；回退即 revert 该 commit。
- localStorage key 新增无迁移负担。
