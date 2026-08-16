# Agent annotations and jump-to-source

## Goal

打开一本书对话时，助手能通过按需工具看见读者已经留下的书签和高亮；用户点工具结果里的引用后，阅读器翻到对应位置。助手只读标注，不替读者改划线，也不自己翻书。

## User Value

读者划过的句子是最强的兴趣信号，但现在助手只能看见本轮选中或自己搜到的正文。补上标注后，「我划过的重点里作者怎么论证 X」不必再选一次。聊完点一下引用就能回到原文，对话和书钉在一起。

## Parent / Children

| Child | Owns |
|---|---|
| `08-16-agent-read-annotations` | 只读工具 `list_annotations` |
| `08-16-agent-jump-to-source` | 工具结果里的引用可点，阅读器跳到该处 |

父任务不直接改产品代码。跨子任务验收：标注列表和跳转用同一套当前书、同一套定位字段，互不破坏现有选段提问和书内搜索。先做读标注，再做跳转（跳转要消费新工具的结果形状）。

## Background / Confirmed Facts

- 现有四个书工具全是只读正文：`get_book_metadata`、`get_toc`、`read_chapter`、`search_in_book`（`src/agent/runtime/embedded-runtime.ts` `tools()`）。
- 每轮已注入书快照和阅读上下文（当前章节、选中原文）。标注不在其中。
- 标注在 `books/<id>/annotations.json`，经 `get_annotations` / `save_annotations` 读写。书签 `{ id, cfi, fraction, createdAt, label? }`，高亮 `{ id, cfi, excerpt, createdAt }`。无笔记、无多色。
- 阅读器已能 `goToTocItem` / `goToFraction` / `goToCfi`。标注抽屉走 `jumpToAnnotation(cfi, fraction?)`（`src/App.tsx`）。
- `ToolCallCard` 只展示 JSON。助手 Markdown 链接是外链。Agent 事件没有导航动作。
- 工具结果会进会话 JSONL；重开会话后卡片仍能看到当时的文本。`book_changed` 会清空消息，因此跨书的旧引用不会留在当前面板。
- Agent `chapterIndex` 是 TOC 拥有列表下标，与 foliate 侧栏树不是同一数组。搜索/读章没有 CFI；`part` 无法映射到阅读器定位。TOC 内部 `hrefs` 对模型隐藏。
- Agent 模式书可折叠。选段问助手时会展开书。

## Key Decisions

- **D1** 跳转由用户点引用发起。不做 `open_in_reader`。可点对象是结构化工具结果：搜索命中、读章结果、`list_annotations` 条目。不解析助手正文链接。
- **D2** 不做笔记产品：无笔记字段、不多色、不导出。
- **D3** 标注是按需工具 `list_annotations`，不注入书快照或 `readingContext`。
- **D4** 没有 CFI 的搜索/读章引用跳到该章目录入口（章首）。有 CFI 的标注跳到该 CFI。

## Requirements

1. **R1** 助手通过无参工具 `list_annotations` 取得当前书的书签和高亮，并用它们回答。不能新增、修改、删除标注。不自动注入。
2. **R2** 用户点工具结果里的引用后，当前书的阅读器翻到该处。标注走 CFI（书签失败时可回退 fraction）；搜索/读章走该 `chapterIndex` 的目录入口。
3. **R3** 标注读取和跳转只作用于当前 `bookId`。切书后不得读到上一本，也不得跳上一本。
4. **R4** 选段提问、书快照、四个正文工具、标注抽屉、目录、进度条的现有语义不变。不新增由模型调用的翻书工具。
5. **R5** 点引用时若 Agent 模式书已折叠，先展开再跳。

## Out of Scope

- `open_in_reader` 或模型主动翻书
- 助手正文自定义引用协议
- 助手写入或删除标注
- 笔记、多色、导出
- 跨书搜索、跨会话记忆、剧透闸、TTS、总结/翻译/解词工具
- 搜索文本 offset → CFI，或按 `part` 落到 12k 窗口
- 父任务自身的产品代码改动

## Acceptance Criteria

- [ ] AC1 当前书有标注时，助手能在不依赖本轮选区的情况下引用那些书签/高亮。
- [ ] AC2 用户点搜索命中或读章卡片后，阅读器打开该章；点标注条目后，阅读器跳到该 CFI。
- [ ] AC3 模型不会在回答过程中自己改变阅读位置。
- [ ] AC4 助手不能创建、修改或删除任何标注。
- [ ] AC5 选段提问、正文工具、标注抽屉的既有行为保持不变。
- [ ] AC6 Agent 模式书折叠时，点击引用会先展开书再跳。
