# Jump reader to cited book location

## Goal

用户点对话里工具结果中的引用后，当前书的阅读器翻到对应位置，不必再自己点目录或标注抽屉。

## Parent Reference

父任务：`08-16-agent-annotate-and-jump`（D1 / D4 / R2 / R3 / R4 / R5）。依赖 `08-16-agent-read-annotations` 的 `list_annotations` 结果形状；搜索/读章的可点不依赖新工具，但实现顺序仍是先标注、后跳转，一次做完三种卡片。

## Background / Confirmed Facts

- `ReaderViewHandle` 已有 `goToTocItem`、`goToFraction`、`goToCfi`。标注抽屉已用 `jumpToAnnotation(cfi, fraction?)`。
- `ToolCallCard` 把结果渲染成 `<pre>`。助手 Markdown 链接是外链。
- `search_in_book` 命中：`chapterIndex` + `part` + `snippet` + 可选 `chapterTitle`。`read_chapter`：`chapterIndex` + `part`。`list_annotations`：条目带 `cfi`。
- Agent `chapterIndex` 是 worker TOC 拥有列表，不是 App 里 foliate `toc` 树的扁平下标。应用 `chapterIndex` 必须经 worker TOC 的 `hrefs` 再 `goToTocItem`，不能用 `flattenToc(readerToc)[i]`。
- 工具结果会写入会话 JSONL；重开会话后卡片仍能解析当时的文本。`book_changed` 清空消息。
- Agent 模式书可折叠。选段问助手时会 `setBookCollapsed(false)`。

## Key Decisions

- 只做用户点击工具结果。不加 `open_in_reader`，不解析助手正文链接。
- 无 CFI：跳到该章目录入口。有 CFI：走现有 `jumpToAnnotation`。
- 历史会话里已存的 `search_in_book` / `read_chapter` JSON 也应可点。

## Requirements

1. `search_in_book` 的每条命中可点，跳到该 `chapterIndex` 的目录入口。
2. `read_chapter` 的工具卡可点，跳到该章目录入口。
3. `list_annotations` 的每条书签/高亮可点：`goToCfi`，书签失败时回退 `fraction`。
4. 只跳当前打开的书。切书或关书后，点旧引用不得作用到另一本（当前面板在切书时已清空消息）。
5. Agent 模式下若书已折叠，先展开再跳。
6. 不改动目录、进度条、标注抽屉自己的跳转语义。
7. 历史会话里已经存下的搜索/读章 JSON 可点，不必重跑工具。

## Out of Scope

- `open_in_reader`
- 助手正文自定义引用协议
- 搜索文本 offset → CFI
- 按 `part` 精确落到 12k 窗口
- 跨书跳转

## Acceptance Criteria

- [ ] AC1 点一条搜索命中后，阅读器打开该命中的章节（章首）。
- [ ] AC2 点一次读章工具卡后，阅读器打开该章（章首）。
- [ ] AC3 点一条高亮/书签引用后，阅读器跳到该 CFI（与标注抽屉一致）。
- [ ] AC4 书在 Agent 模式折叠时，点击引用会先展开书再跳。
- [ ] AC5 切书或关书后，过期引用不会翻到另一本书。
- [ ] AC6 目录、进度条、标注抽屉的既有跳转仍可用。
- [ ] AC7 没有新增由模型调用的翻书工具。
