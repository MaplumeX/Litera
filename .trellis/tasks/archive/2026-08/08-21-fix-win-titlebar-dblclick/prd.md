# Fix titlebar double-click maximize dead on Windows

## Goal

在 Windows 上双击书库页和阅读页顶栏的标题文字或空白区，窗口应在最大化与还原之间可靠切换。当前 v0.2.5 双击完全无反应。

## Context

- 环境：Windows，v0.2.5 打包安装版（undecorated window + 自定义顶栏）
- 现状：双击标题文字和空白区均无反应；最大化按钮（单独调用 `toggleMaximize()`）工作正常
- 相关历史：f75bf30 修复了拖拽与双击的竞态（`data-tauri-drag-region` → JS 手势判定），但只在 jsdom 单测中验证，**从未在真实 Tauri 环境人工验证**
- 根因方向：Windows WebView2 输入管线下第二次 `pointerdown` 的 `event.detail` 可能不是 2（与第一次点击时的 `setPointerCapture` 时序相关，参见 Chromium issue #40675080），导致双击分支从未执行

## Requirements

- R1: 双击顶栏标题文字区域，窗口最大化/还原切换
- R2: 双击顶栏空白 spacer 区域，窗口最大化/还原切换
- R3: 修复不能回退 R1-R4 中原有的行为：
  - 单击后移动超过 4px 仍可拖动窗口
  - 单击（未超阈值）不触发最大化或拖动
  - 中键/右键按下不产生任何效果
- R4: 修复须同时适用于 Windows，且不破坏 macOS / Linux 的现有行为
- R5: 最大化按钮（`□` 图标）继续正常工作

## Acceptance Criteria

- [ ] AC1: Windows 上双击标题文字 → 窗口最大化，再次双击 → 还原
- [ ] AC2: Windows 上双击空白区 → 同上
- [ ] AC3: Windows 上单击拖动窗口正常
- [ ] AC4: 单元测试模拟真实双击序列（两次 pointerdown 均 `detail: 1`）仍触发 `toggleMaximize`
- [ ] AC5: 现有测试全部通过（npm test）
- [ ] AC6: macOS / Linux 上双击和拖动行为不变

## Notes

- 保持轻量：单一文件修复（`WindowControls.tsx`），PRD + design 即可
- 真实 Windows 验证由用户在执行后手动确认
