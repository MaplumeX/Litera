# Agent can list bookmarks and highlights

## Goal

当前打开书的书签和高亮对阅读助手可见。模型通过按需工具 `list_annotations` 读取它们，并按读者已经划过、钉过的内容回答。

## Parent Reference

父任务：`08-16-agent-annotate-and-jump`（D3 / R1 / R3 / R4）。不负责点击跳转（`08-16-agent-jump-to-source`），但返回的每条记录必须带上跳转侧能用的定位字段。

## Background / Confirmed Facts

- 标注在 `books/<id>/annotations.json`，经 `get_annotations` / `save_annotations` 读写。schema 1：书签带可选 `label` 和 `fraction`，高亮带 `excerpt`，都有 `cfi`。高亮 excerpt 上限 4KiB。
- `LiteraAgentRuntime` 工具集不含标注。书快照和 `readingContext` 也不含标注。
- Runtime 已用 `invoke` 读配置（`get_agent_runtime_config`）。`get_annotations` 是现成的 Tauri 命令，缺文件时返回空列表。
- 切书会换 worker / session；工具必须用当前 `bookId` 门闩，与现有 `bookCall` 一致。
- 父 D1：跳转靠用户点工具结果，因此输出必须是结构化 JSON，不是散文。

## Key Decisions

- 只注册一个无参工具 `list_annotations`，一次返回 `{ bookmarks, highlights }`。不拆两个工具，不做分页，不截断条数。
- 从磁盘读当前书（`get_annotations`），不读 React state，不写 `save_annotations`。

## Requirements

1. 注册只读工具 `list_annotations`（无参数）。返回当前书全部书签和高亮：高亮 `excerpt`、书签 `label` / `fraction`、`createdAt`、`id`，以及跳转用的 `cfi`。
2. 空列表是合法结果，不是错误。
3. 切书后调用不得返回上一本书的标注。无打开书时与现有书工具一样失败。
4. 不写 `save_annotations`，不改 `annotations.json`，不把标注写入书快照或 `readingContext`。
5. 系统提示和工具描述说明：回答「我划过的 / 我书签里的」时应调用 `list_annotations`，而不是只靠选区。

## Out of Scope

- 写入或删除标注
- 笔记产品
- 点击跳转 UI
- 自动注入
- 分页 / 条数上限

## Acceptance Criteria

- [ ] AC1 当前书有高亮时，助手能在不依赖本轮选区的情况下引用那些摘录。
- [ ] AC2 当前书有书签时，助手能说出书签标签或对应位置信息。
- [ ] AC3 没有标注时工具返回空的 `bookmarks` / `highlights`，对话仍可继续。
- [ ] AC4 切到另一本书后，助手看不到上一本的标注。
- [ ] AC5 本任务不产生任何 `save_annotations` 写路径。
- [ ] AC6 每条结果带有 `cfi`（书签另带 `fraction`），供跳转子任务解析。
