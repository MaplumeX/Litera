# Match continue-reading card size to the library grid

## Goal

让书库「继续阅读」封面与下方书架网格卡片一样大，不再被拉成整列宽度。

## User Value

打开书库时，最近在读的书和书架上的书是同一套封面尺寸，顶部不再出现一块特别大的卡片。

## Background / Confirmed Facts

- 用户反馈「继续阅读」封面显示过大，要求与普通书籍一致。
- `LibraryView` 继续阅读区使用 `grid grid-cols-4 gap-4`（`src/components/LibraryView.tsx:403`）。固定 4 列会把每张卡拉满约 1/4 内容宽度。
- 下方书架网格使用 `grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6`（同文件 `:433`）。卡片约 140px 起排。
- 两处都渲染同一个 `BookCard`（`aspect-[2/3] w-full`）。过大只来自容器，不是封面组件本身。
- 继续阅读数据来自 `takeRecent(books)`，上限 `RECENT_LIMIT = 4`。空书库、从未打开过任何书、或搜索中不显示该区。这 4 本仍出现在下方主列表。
- 原任务 `08-23-library-improvements` 写过「常见窗口宽度下 4 本并排」。`grid-cols-4` 实现了并排铺满，也造成了这次的过大。本任务以用户最新意图为准：尺寸对齐书架，而不是铺满一行。
- 列表视图下，继续阅读仍是卡片横排，主列表才切成 `BookListRow`。用户抱怨的是卡片过大，不是继续阅读要改成列表行。

## Key Decisions

- 继续阅读网格复用书架网格的列模板和间距，不再使用固定 4 列。
- 继续阅读仍最多 4 本、仍用 `BookCard`、仍不受主列表排序影响。列表视图下继续阅读保持卡片，不改成列表行。
- 不新增卡片变体，不改 `BookCard` 比例。

## Requirements

### R1 继续阅读卡片与书架网格同尺寸

- 非搜索、网格视图下，「继续阅读」每张封面的宽度、间距与下方书架 `BookCard` 一致。
- 实现上继续阅读网格必须使用与书架网格相同的 `grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-6`，不得再使用 `grid-cols-4`。
- 窄窗口允许换行；不要为了塞进 4 本而把卡片拉宽或压窄，也不要横向滚动。

### R2 其余继续阅读行为保持不变

- 仍最多 4 本最近打开过的书，按 `lastOpenedAt` 倒序。
- 空书库、从未打开、搜索中：不显示该区域。
- 这些书仍出现在下方主列表。点击封面仍打开书；选择模式仍勾选；右键菜单仍可用；该区仍无 hover 删除和 ⋮（`showDelete={false}` / `showMenu={false}`）。
- 不改 `takeRecent`、`RECENT_LIMIT`、排序、详情、导入/删除。

## Acceptance Criteria

- [ ] AC1. 网格视图下，继续阅读卡片与下方书架卡片使用同一套列模板和间距，视觉尺寸一致。（R1）
- [ ] AC2. `LibraryView` 中不再出现 `grid-cols-4`。继续阅读网格 class 与书架网格 class 相同。（R1）
- [ ] AC3. 有最近打开的书且未搜索时仍显示「继续阅读」；搜索时隐藏；最多 4 本；点击仍打开对应书。（R2）
- [ ] AC4. 继续阅读卡片仍无 hover 删除和 ⋮，右键菜单仍可用。（R2）
- [ ] AC5. 列表视图、排序、选择模式、详情、导入删除行为不因本任务改变。（R2）

## Out of Scope

- 把继续阅读改成列表行
- 调整 `RECENT_LIMIT` 或继续阅读排序规则
- 横向滑动的最近阅读条
- 新的大卡 / 英雄卡组件
- 后端、`BookRecord`、持久化

## Technical Notes

- 改动集中在 `src/components/LibraryView.tsx` 继续阅读网格 class。测试在 `src/components/LibraryView.test.tsx` 增加两处网格 class 一致的断言即可。
- 这是轻量前端视觉修正，PRD-only。
