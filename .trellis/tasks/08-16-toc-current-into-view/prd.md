# Scroll current TOC item into view

## Goal

打开目录后，当前阅读位置对应的条目必须在侧栏视口里。目录保持打开、当前章变化时，条目跑出视口也要跟回来。

## User value

长目录里当前章往往在视口外。高亮已经有了，看不见就等于没有定位。

## Confirmed facts

- `TocSidebar` 已按 `currentHref` 高亮当前行（`bg-accent font-medium`）。匹配是 `item.href === currentHref`。
- `App.tsx` 传入 `currentHref={progress.chapterHref}`。`chapterHref` 来自 foliate `relocate` 的 `tocItem.href`，否则回退 `sections[index].id`。
- 目录是覆盖抽屉：`{tocVisible && <TocSidebar ... />}`，每次打开都会重新挂载。
- 点目录项会 `goToTocItem` 并 `setTocVisible(false)` 关掉抽屉。
- 抽屉开着时，底栏上一章/下一章和进度条仍可用，`currentHref` 会变，侧栏仍挂着。
- 滚动容器是 `TocSidebar` 里 `flex-1 overflow-y-auto` 的列表区，不是外层抽屉。
- 现有测试：`src/components/TocSidebar.test.tsx` 只断言高亮和跳转，没有 `scrollIntoView`。

## Decisions

- **D1** 打开时滚；目录开着且 `currentHref` 变化时也滚。`block: "nearest"`，已在视口内不跳。
- **D2** `behavior: "auto"`，立即到位，不要 smooth。
- **D3** 不改 href 匹配。匹配失败时不滚动。

## Requirements

### R1 当前项进入视口

- 目录打开后，若存在与 `currentHref` 匹配的条目，该条目必须在列表滚动容器的可见区域内。
- 目录保持打开、`currentHref` 变为另一条匹配项时：新当前项若已在视口内则不滚动；若在视口外则滚到刚可见。
- 无 `currentHref`、或没有任何条目匹配时，不滚动。打开时列表停在顶部。

### R2 滚动方式

- 用当前条目的 `scrollIntoView({ block: "nearest", behavior: "auto" })`。
- 已在视口内不改变滚动位置。

### R3 既有行为不变

- 不改高亮样式、href 匹配、缩进、空态、抽屉开关、点条目后关闭、宽度拖拽。
- 不改 `progress.chapterHref` 的来源。
- 不新增文案或 aria。

## Acceptance Criteria

- [ ] AC1. 打开目录时，匹配 `currentHref` 的条目在列表视口内（必要时自动滚动）。（R1, D1）
- [ ] AC2. 当前项已在视口内时，打开目录或 `currentHref` 变化都不改变滚动位置。（R2, D1）
- [ ] AC3. 目录开着、`currentHref` 换成视口外的另一条时，新当前项进入视口。（R1, D1）
- [ ] AC4. 没有 `currentHref` 或没有任何匹配项时，不调用滚动。（R1, D3）
- [ ] AC5. 高亮、跳转、点条目关抽屉、宽度拖拽行为与现有测试一致。（R3）
- [ ] AC6. `TocSidebar` 有针对打开滚动和 `currentHref` 变化滚动的测试；`npm test` 与 `npm run build` 通过。

## Out of scope

- 修 href 匹配（fragment / 路径前缀）。
- 顶栏显示章名。
- 比 TOC 条目更细的文内 heading 监听。
- 把目录改成常驻列。
- 标注抽屉。
