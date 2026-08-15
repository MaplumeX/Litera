# Make TOC sidebar width resizable

## Goal

目录侧边栏（`TocSidebar`）目前是固定宽度（`w-56`，224px）的 overlay 抽屉。让它像 AI 对话面板一样，可以通过拖拽调整宽度，并把用户调整的宽度持久化，重启后保持。

## Background

- 阅读页布局：`App.tsx` 中 `Group id="reader-chat"` 用 `react-resizable-panels` v4 实现「阅读器 + AI 对话」分栏，对话面板宽度可拖拽，且通过 `useDefaultLayout({ id: "reader-chat", onlySaveAfterUserInteractions: true })` 持久化。
- 目录（`TocSidebar`）和批注（`AnnotationsSidebar`）是 overlay 抽屉：绝对定位在阅读器上方，固定 `w-56`，点击遮罩或 Esc 关闭。
- 本次只改目录抽屉，不改批注抽屉，不改 AI 对话面板。

## Requirements

### R1 目录抽屉宽度可拖拽调整

- 目录抽屉右侧边缘有一个拖拽手柄（视觉上类似 `Separator` 的 `cursor-col-resize`），按住可水平拖动改变宽度。
- 拖拽过程中宽度实时跟随指针。
- 宽度有下限和上限：最小 160px（保证目录项可读），最大不超过阅读器区域宽度（即不超出抽屉所在容器，`max-w` 用百分比或视口约束均可，但必须保证不溢出窗口）。
- 拖拽手柄在 hover 时有视觉反馈（如 `hover:bg-primary/30`），与 AI 对话面板的 `Separator` 风格一致。

### R2 宽度持久化

- 用户拖拽调整后的宽度保存到 `localStorage`，重启应用后目录抽屉以保存的宽度打开。
- 持久化 key 与现有代码风格一致（参考 `src/lib/i18n.ts` 的 `LOCALE_STORAGE_KEY` 模式）。
- 首次使用（无保存值）时仍用当前默认宽度 224px（`w-56`）。

### R3 行为与范围不变

- 不改目录的打开/关闭交互（点击遮罩、Esc、工具栏按钮）。
- 不改 `TocSidebar` 内部渲染逻辑（目录项、缩进、空态）。
- 不改批注抽屉（`AnnotationsSidebar`）。
- 不改 AI 对话面板及其持久化逻辑。

## Acceptance Criteria

- [ ] 目录抽屉打开后，右侧边缘出现可拖拽手柄，hover 有视觉反馈。
- [ ] 按住手柄左右拖动，抽屉宽度实时变化，且不超出 [160px, 容器宽度] 范围。
- [ ] 调整宽度后关闭再打开目录，宽度保持；重启应用后宽度仍保持。
- [ ] 首次使用（无保存值）宽度为 224px。
- [ ] 目录项在窄宽度下仍正常截断显示（`truncate`），不换行错乱。
- [ ] 现有测试全过：`npm test` + `npm run build` 通过。
- [ ] 新增针对宽度调整逻辑的测试（拖拽改变宽度、持久化读写、边界钳制）。

## Out of Scope

- 不改批注抽屉（`AnnotationsSidebar`）。
- 不改 AI 对话面板。
- 不把目录改成常驻分栏（保持 overlay 抽屉形态）。
- 不做宽度记忆的 UI 设置项。
