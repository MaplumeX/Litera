# Agent mode TOC/bookmark buttons follow the book

## Goal

Agent 模式下，目录和标注按钮出现在书籍所在的右侧顶栏簇里，而不是窗口最左侧。阅读模式顶栏保持不变。

## User value

Agent 模式书在右、聊天在左。目录 / 标注管的是书，按钮却钉在返回书库旁边，和书被整块聊天区隔开。控件跟书走之后，看书时手和眼都在右侧。

## Background

- 两种模式共用同一套 header 和两个 grid 格子；模式只换 `grid-template-areas`（`src/App.tsx:926`）。阅读：`"book chat"`；Agent：`"chat book"`。
- 顶栏现序（`src/App.tsx:824-918`）：`[←][目录][标注] 书名 [spacer] [Aa] | [模式][阅读: 聊天 | Agent: 书] [窗口按钮]`。目录 / 标注写死在返回按钮之后（`src/App.tsx:833-860`）。
- 抽屉是书格子上的绝对定位左叠层，不是第三列（`src/App.tsx:955-1006`）。打开目录 / 标注会关掉另一个，并在书收起时先展开书。
- Spec 把「目录 / 标注紧跟返回、在书名左侧」写成两种模式共用的约定（`.trellis/spec/frontend/component-guidelines.md` layout ascii 与「TOC / 标注 sit immediately after back」）。本任务的 Agent 分组覆盖该约定；Phase 3.3 再改 spec。
- 阅读模式顶栏按钮顺序已有测试：`src/App.annotations.test.tsx:294-308`。默认 `openReader()` 是阅读模式。Agent 模式没有对等的顺序断言。

## Decisions

- **D1** 只改 Agent 模式顶栏。阅读模式顺序与现测一致。
- **D2** Agent 顶栏：`[←] 书名 [spacer] [Aa] | [目录][标注] [模式][书] [窗口按钮]`。目录 / 标注贴在「书」按钮左侧，落在现有 `1px` 分隔线右侧，与 Aa、窗口按钮分开。
- **D3** 不改抽屉：仍从书格子左缘叠出，可 resize 的目录、固定宽标注、backdrop / Esc / 互斥 / 点条目关闭。不从右缘滑出，不加竖条，不加第二行 titlebar。
- **D4** 不改 Aa、书名、返回、模式切换、显隐书、窗口按钮的位置与含义。
- **D5** 不改目录 / 标注的开关语义：互斥；书收起时先展开再打开；不 persist 打开态；不 remount `ReaderView`。

## Requirements

### R1 Agent 顶栏：书的控件跟书走

- `readerMode === "agent"` 时，目录和标注按钮必须出现在右侧簇、`1px` 分隔线之后、模式切换与「显隐书」之前。
- 左侧在返回书库之后直接是书名，中间不再夹目录 / 标注。
- Aa 仍在分隔线左侧。

### R2 阅读模式顶栏不变

- `readerMode === "reader"` 时按钮顺序仍为：返回、目录、标注、书名、Aa、分隔线、模式、显隐对话、窗口按钮。
- 模式切换不得改变阅读模式这一顺序。

### R3 抽屉与开关行为不变

- 目录 / 标注仍 overlay 在书格子上，从书的左缘滑出。
- 打开其一关闭另一；书收起时打开目录 / 标注必须先展开书。
- 点击列表行仍跳转并关闭抽屉。不 persist 打开态。不 remount `ReaderView`。

### R4 测试与文档

- 阅读模式保留现有顶栏顺序断言。
- 新增 Agent 模式顶栏顺序断言，覆盖 D2。
- 现有目录 / 标注行为测试（互斥、添加书签、收起书后开目录会展开）继续通过。
- Phase 3.3 更新 frontend component spec 的 header layout，使 Agent 分组与 D2 一致。

## Acceptance Criteria

- [ ] AC1. Agent 模式下，header 按钮顺序为：返回书库、字体与主题、目录、标注、切换到阅读模式、显隐书、（Win/Linux）窗口按钮。目录 / 标注在 `1px` 分隔线右侧。（R1, D2）
- [ ] AC2. 阅读模式下，header 按钮顺序与现测一致：返回书库、目录、标注、字体与主题、切换到 Agent 模式、显示对话、（Win/Linux）关闭窗口。（R2, D1）
- [ ] AC3. Agent 模式下打开目录 / 标注，抽屉仍从书格子左缘叠出；两者互斥；书收起时先展开书再打开。（R3, D3, D5）
- [ ] AC4. 不出现第二行 titlebar、书边竖条、或从窗口右缘滑出的抽屉。（D3, D4）
- [ ] AC5. `src/App.annotations.test.tsx` 保留阅读模式顺序断言；新增 Agent 模式顺序断言。`src/App.reader-mode.test.tsx` 中「收起书后点目录会展开」仍通过。`npm test` 与 `npm run build` 通过。

## Out of scope

- 把目录 / 标注抽屉改到书的右缘。
- 书格子边再加一条图标轨。
- 书格子自己的顶栏或第二行 chrome。
- 移动 Aa、书名、或改变左右格子对调。
- 改抽屉宽度、resize、高亮、跳转、或标注数据模型。
- 新文案或新 aria（沿用 `reader.toc` / `reader.annotations`）。
