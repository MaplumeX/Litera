# Polish reader layout to desktop conventions

## Goal

让阅读页看起来、用起来像桌面 EPUB 阅读器：书页是独立画布，顶栏按功能分组，进度条贴在书页底且能靠谱地跳章、跳进度。阅读/Agent 信息架构不变。

## User value

刚做完的外壳换肤没有动布局。打开书仍像工具壳里嵌了一个 iframe：顶栏图标平铺、进度条又细又盲、目录像调试抽屉。按 Foliate / Readest / Kindle 的桌面惯例改完后，读者能一眼认出「这是在读书」，并能用底栏跳到某一章或全书某处，而不只靠点页和目录。

## Background

- `08-15-ui-refresh` 换了 Geist、冷灰 token、扁平层次，明确不改阅读/Agent 分栏。
- `08-13-reading-ui-layout` 定了阅读优先：目录/标注是覆盖抽屉，对话默认收起，否决了自动藏顶栏。
- `08-14-reader-progress-scrubber` 在顶栏下加了可点可拖的 20px 细条。可视轨道 2px，没有滑块、没有章节刻度、按下立刻 `goToFraction`，跳转不好用。
- 翻页已经由书页左右点击区、方向键、滚轮承担。底栏曾有「上一页/下一页」，`08-12-modernize-reader-ui` 拿掉了。

## Confirmed facts

- 壳在 `src/App.tsx`：`titlebarClassName()` 顶栏 + 阅读模式下顶栏下的 `ReaderProgressBar` + `reader-shell` 双格（`book` / `chat`）。Agent 模式进度条在书格顶部。
- 顶栏右侧一排：目录、标注、Aa、模式、阅读模式对话 / Agent 模式会话+书。Agent 的会话按钮和 `ChatPanel` 标题栏里的是同一件事。
- `ReaderProgressBar`（`src/components/ReaderProgressBar.tsx`）把 `chapterLabel · {pct}%` 挤在轨道右边。`fractionFromPointer` 把指针 x 映射到 0–1。拖动走 `createLatestSerializedTaskController` latest-wins。
- TOC 已在 `onBookReady` 进 `App` 的 `toc`。当前位置有 `progress.chapterHref` 和 `progress.label`。
- foliate-view 已有 `getSectionFractions()`（脊部 section 起点）和 `goTo` / `goToFraction`。不要改 `src/foliate-js`。
- 应用壳是冷的产品工具表面。书页字体/背景仍由用户阅读设置注入 iframe。`preferences.json` 是 `deny_unknown_fields`，新开合状态不写磁盘。
- 文案走 `useT()`，zh-CN / en 必须成对。

## Decisions

- **D1** 对标桌面阅读器（Foliate / Readest / Apple Books macOS），不是手机那种点一下才出栏。
- **D2** 顶栏分组：返回左边放目录、标注；右边是 Aa，竖线，然后模式 + 对话（阅读）或模式 + 书（Agent）。Agent 顶栏去掉会话按钮，只留对话面板里的。
- **D3** 进度条移到书格底部，两种模式都在书格里，不跨到对话栏。章节名在左，轨道在中，百分比在右。
- **D4** 进度交互按 Foliate/Readest/Kindle：可见圆钮、约 36px 点按区、section 刻度、拖动时预览目标、两侧上一章/下一章。不恢复上一页/下一页。拖动时条子立刻跟上指针，书在松开（或单击）时再 `goToFraction`。
- **D5** 书页做成和外壳有一点区分的画布（轻微页边或一档表面色）。整窗仍是冷灰工具壳，不要暖纸骨色铺满应用。
- **D6** 目录/标注仍是盖在书上的抽屉。做成正经面板：当前章高亮、间距和标题理清。不改回固定第三列。

## Requirements

### R1 顶栏按钮分组

- 阅读模式：`[←] [目录][标注]  书名  [Aa] | [模式][对话]  [窗口]`。
- Agent 模式：`[←] [目录][标注]  书名  [Aa] | [模式][书]  [窗口]`。顶栏不再有会话按钮。
- 组内 `gap-1`，组与组之间拉开，Aa 和模式之间一条细竖线。
- 按钮仍是 `icon-sm`，关 `ghost`、开 `secondary`，`aria-label` 走 `useT()`。
- 拖动窗口、macOS 红绿灯 inset、Win/Linux 窗口按钮规则不变。

### R2 书页画布

- 书格里的正文区和外壳在视觉上分开：轻微内边或一档表面色。
- 不把 Geist 写进 foliate 书页 CSS。用户选的字体、字号、阅读主题继续只作用在书页上。
- 不改翻页热区、选区工具条、高亮绘制的语义。坐标仍相对书页，不要因为页边把点击翻页算错。

### R3 底栏进度

- `ReaderProgressBar` 只出现在书格底部。阅读模式不再占用顶栏下一整行。Agent 模式从书格顶改到底。
- 左：当前章节名（小字、灰色、过长截断）。中：细轨 + 圆钮 + section 刻度。右：`{pct}%`（tabular-nums）。
- 视觉轨约 2px，整行点按高度约 36px，圆钮平时约 10px，拖动时略放大。
- 刻度来自 foliate `getSectionFractions()`。没有分数时只画轨和圆钮。
- 单击：立刻按指针位置 `goToFraction`。拖动：条子和预览跟着走，松手再 seek。仍用 latest-wins，避免拖太快打爆 foliate。
- 拖动/悬停预览：`{章节} · {pct}%`；章节未知时只显示百分比。预览是瞬时 UI，不写磁盘。
- 两侧上一章/下一章：按摊平后的 TOC、以当前 `chapterHref` 定位，调用现有 `goToTocItem`。没有上一/下一章时按钮禁用。TOC 为空时两颗都禁用。
- 不加页码、剩余时间、悬停才出现的条、上一页/下一页。

### R4 目录/标注抽屉

- 仍是书格上的左侧覆盖层：遮罩、Esc、点章节/条目后关闭。目录可拖宽度，标注固定 `w-56`。
- 目录标出当前 `chapterHref` 对应项。
- 标题、列表间距、层次按正经侧栏来，不要调试面板那种挤法。
- 不把抽屉改成固定列，不永久挤窄正文。

### R5 既有行为

- 阅读/Agent 双格、默认阅读模式、对话默认收起、开合只记进程、不 remount `ReaderView` / `ChatPanel`。
- 点页、方向键、滚轮翻页不变。
- 选区高亮 / 问 agent、书签、位置恢复、设置对话框、i18n、窗口控件不变。
- 不往 `preferences.json` 加字段。

## Acceptance Criteria

- [ ] AC1. 阅读模式顶栏是「返回 + 目录 + 标注 | 书名 | Aa | 模式 + 对话」。Agent 顶栏是「返回 + 目录 + 标注 | 书名 | Aa | 模式 + 书」，没有第三颗会话按钮。组与组之间有间距和一条细竖线。（R1）
- [ ] AC2. 书页和外壳能分清，书页字体仍只跟阅读设置走。（R2）
- [ ] AC3. 进度条在书格底部；阅读模式顶栏下不再有那条 20px 细条。章节名在左，百分比在右。Agent 模式也不跨到对话栏。（R3）
- [ ] AC4. 单击进度条跳到对应全书 fraction；拖动时圆钮和填充跟上指针并显示预览，松手后正文停在该进度。刻度在有 `getSectionFractions()` 时可见。（R3）
- [ ] AC5. 上一章/下一章按 TOC 跳转；在首章/末章或没有 TOC 时禁用。点页、方向键、滚轮翻页仍可用。（R3, R5）
- [ ] AC6. 打开目录时当前章可辨认；目录/标注仍是覆盖抽屉，不是固定列。（R4）
- [ ] AC7. 新增可见文案（上一章、下一章、预览/aria）走 `useT()`，zh-CN / en 成对。（R5）
- [ ] AC8. 现有阅读器前端测试更新后通过；`npm test` 与 `npm run build` 通过。（R5）

## Out of scope

- 自动隐藏顶栏或进度条
- 目录钉成固定第三列
- 上一页 / 下一页按钮
- 页码、剩余阅读时间、书内搜索
- 换图标库、换 UI 框架、改 foliate.js
- 书库页、对话气泡、设置对话框再设计
- Agent 协议、sidecar、持久化 schema
