# Persist AI chat panel width

## Goal

持久化阅读器中 AI 对话面板（chat panel）的宽度，使应用重启后恢复用户上次拖拽调整的宽度，而不是每次都回到默认的 22%。

## Background

`src/App.tsx` 用 `react-resizable-panels` v4.12.2 的 `Group`/`Panel` 实现阅读器与聊天面板的分栏：

```tsx
<Group
  orientation="horizontal"
  defaultLayout={chatCollapsed ? { reader: 100, chat: 0 } : { reader: 78, chat: 22 }}
>
  <Panel id="reader" defaultSize="78" minSize="40" />
  <Separator ... />
  <Panel id="chat" defaultSize="22" minSize="18" collapsible ... />
</Group>
```

`defaultLayout` 硬编码为 78/22，且未使用库提供的 `useDefaultLayout` hook，因此宽度与折叠状态均不持久化。

## Requirements

1. 用户拖拽调整聊天面板宽度后，重启应用（重新挂载 App）时恢复该宽度。
2. 折叠/展开状态（`chatCollapsed`）不做持久化要求——本次修复聚焦宽度；折叠由阅读选择/按钮等交互触发，保持现有行为即可。但持久化的宽度不得被折叠相关逻辑破坏。
3. 无保存值时回退到现有默认布局（reader 78 / chat 22）。

## Design decisions (research findings)

- 库自带 `useDefaultLayout({ id })` hook，内部读写 `localStorage`（key 形如 `react-resizable-panels:<id>`），返回 `defaultLayout` + `onLayoutChanged`。
- 库 hook 的持久化回调会保存**每次**布局提交（含 imperative collapse/expand），只有显式传 `onlySaveAfterUserInteractions` 才只存用户交互。传该选项可避免折叠按钮触发的 `{reader:100, chat:0}` 布局被写入存储。
- 现有 `useLayoutEffect` 中 `if (panel.isCollapsed() || panel.getSize().asPercentage <= 18) panel.resize("22")` 会在展开时把用户保存的小宽度（18–22% 之间）重置掉，需要调整。
- App 测试（`App.annotations.test.tsx`）mock 了 `react-resizable-panels` 整个模块，新代码需同步 mock `useDefaultLayout`，或保持 mock 兼容（hook 返回 undefined 时 Group 行为不变——但 App 会引用它，mock 必须导出）。

## Acceptance Criteria

- [ ] 拖拽调整聊天面板宽度后，刷新/重启应用，面板恢复到上次拖拽的宽度（非 22% 默认值）。
- [ ] 无保存值时初始布局仍为 reader 78 / chat 22。
- [ ] 折叠（chatCollapsed）时面板收起、展开时回到保存宽度，行为不回归。
- [ ] 现有测试通过（`npm test`），必要时补充/更新 mock 与测试。

## Notes

- 轻量任务，PRD-only；修改集中在 `src/App.tsx` 与 `src/App.annotations.test.tsx`。
- 存储 key 使用 `litera.*` 前缀风格（参考 `litera.locale`），不直接用库默认 key 也行——但优先使用库自带 hook 的默认 key，减少自定义代码；若需自定义前缀可用 `storage` 参数。
