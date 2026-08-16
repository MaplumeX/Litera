# Center current TOC item in sidebar

## Goal

打开目录后，当前阅读位置对应的条目要出现在列表中部附近，而不是贴在视口底边。目录保持打开、当前章变化时：新条目若已完全在视口内则不滚；若在视口外或被裁切，则滚到列表垂直居中。

## User value

长目录里用 `block: "nearest"` 会把后面的章刚好卡在底边，上下几乎看不到相邻条目。居中后能立刻看到上下文。

## Confirmed facts

- `TocSidebar` 已按 `currentHref` 高亮当前行，并在挂载 / `currentHref` 变为另一条匹配项时调用 `scrollIntoView({ block: "nearest", behavior: "auto" })`（`src/components/TocSidebar.tsx:26-29`）。
- `nearest` 在条目位于视口下方时只滚到刚可见，所以当前行会出现在列表底边。这是用户看到的问题，不是排序把当前章排到了最后。
- `App.tsx` 传入 `currentHref={progress.chapterHref}`。目录是覆盖抽屉：`{tocVisible && <TocSidebar ... />}`，每次打开都会重新挂载。
- 滚动容器是 `TocSidebar` 里 `flex-1 overflow-y-auto` 的列表区（`src/components/TocSidebar.tsx:67`），不是外层抽屉。
- 现有 spec 把 `nearest` 写成了约定（`.trellis/spec/frontend/component-guidelines.md`「TOC current row stays in the list viewport」）。本任务的验收行为覆盖该约定；Phase 3.3 再改 spec。
- 现有测试 `src/components/TocSidebar.test.tsx` 断言 `block: "nearest"`。jsdom 的 `getBoundingClientRect` 默认为全 0，若做显式可见性判断，测试必须自行 mock 几何。

## Decisions

- **D1** 当前行整行都在列表视口内：不滚动（用户可能刚自己滚过目录，或翻到的下一章已经看得见）。
- **D2** 当前行在视口外，或上下被裁切：滚到列表垂直居中。不要再用 `block: "nearest"`。
- **D3** `behavior: "auto"`，立即到位，不要 smooth。
- **D4** 不改 href 匹配。匹配失败时不滚动。
- **D5** 只改 `TocSidebar` 的滚动对齐。不改高亮、抽屉开关、宽度拖拽、`chapterHref` 来源。

## Requirements

### R1 视口外居中

- 目录打开后，若存在与 `currentHref` 匹配的条目，且该条目未完全落在列表滚动容器内，则该条目必须出现在列表视口的垂直中部（靠近两端时受滚动范围限制，允许无法真正居中）。
- 目录保持打开、`currentHref` 变为另一条匹配项且新条目未完全在视口内时，同样居中。
- 「完全在视口内」指条目的完整高度都在列表容器的可见矩形里。被顶/底边裁切视为不在视口内。

### R2 已在视口内不滚

- 匹配条目已经完全在列表视口内时：打开目录或 `currentHref` 变化都不得改变滚动位置。
- 只调用 `scrollIntoView({ block: "center" })` 不够：它会在已可见时也重新居中，违反本条。
- 必须先相对列表容器判断可见性，再决定是否滚。只滚列表，不滚外层抽屉或页面。

### R3 无匹配不滚

- 无 `currentHref`、或没有任何条目匹配时，不滚动。打开时列表停在顶部。

### R4 既有行为不变

- 不改高亮样式、href 匹配、缩进、空态、抽屉开关、点条目后关闭、宽度拖拽。
- 不改 `progress.chapterHref` 的来源。
- 不新增文案或 aria。

## Acceptance Criteria

- [ ] AC1. 打开目录时，匹配 `currentHref` 且当时不在列表视口内的条目，出现在列表垂直中部（靠近两端时受滚动范围限制）。（R1, D2）
- [ ] AC2. 当前项已完全在视口内时，打开目录或 `currentHref` 变化都不改变滚动位置。（R2, D1）
- [ ] AC3. 目录开着、`currentHref` 换成视口外或被裁切的另一条时，新当前项居中进入视口。（R1, D2）
- [ ] AC4. 没有 `currentHref` 或没有任何匹配项时，不调用滚动。（R3, D4）
- [ ] AC5. 高亮、跳转、点条目关抽屉、宽度拖拽行为与现有测试一致。（R4）
- [ ] AC6. `TocSidebar` 测试覆盖：视口外打开/切换会居中滚动；视口内打开/切换不滚动；无匹配不滚动。不再断言 `block: "nearest"`。`npm test` 与 `npm run build` 通过。

## Out of scope

- 修 href 匹配（fragment / 路径前缀）。
- 顶栏显示章名。
- 比 TOC 条目更细的文内 heading 监听。
- 把目录改成常驻列。
- 标注抽屉的滚动跟随。
- 平滑滚动。
