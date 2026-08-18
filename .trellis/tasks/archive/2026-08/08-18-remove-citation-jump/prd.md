# Remove agent citation jump-to-location

## Goal

移除 08-16 引入的「点工具结果引用翻书」能力：对话里 `search_in_book` / `read_chapter` / `list_annotations` 的工具结果不再渲染可点击的引用行，点击后不再跳转阅读器。**`list_annotations` 只读工具本身保留**，助手仍能看见读者的书签/高亮。

## Background / Confirmed Facts

- 引用解析在 `src/lib/tool-citations.ts`（`citationsFromToolCall` → `BookCitation`），唯一消费方是 `ToolCallCard`。
- 引用行渲染在 `src/components/chat/ToolCallCard.tsx`（第 35-62 行附近，`citations.length > 0` 区块）；`onOpenCitation` 经 `AssistantMessage` → `ChatPanel` → `App` 传入。
- `App.tsx` 的 `handleOpenCitation`（~714 行）执行：展开折叠的书 → 关 overlay → CFI 走 `jumpToAnnotation`，章节走 `embeddedAgentRuntime.resolveChapterHref` + `goToChapterHref`。
- `resolveChapterHref` 定义在 `src/agent/runtime/embedded-runtime.ts`（46 行），唯一调用方是 `handleOpenCitation`；删除后成为孤儿代码，应一并删除。
- `goToChapterHref` / `goToTocItem` 也被目录、上一章/下一章、`handleTocGoTo` 使用，**保留**。
- `jumpToAnnotation` 也被标注抽屉（书签/高亮）使用，**保留**。
- i18n 键 `chat.citation.*` 共 4 个（en.ts / zh-CN.ts 各 4 个），只被 `ToolCallCard` 使用。
- 相关测试：`src/lib/tool-citations.test.ts`（整文件）、`src/components/chat/AssistantMessage.test.tsx`（3 个引用用例）、`src/App.reader-mode.test.tsx`（2 个跳转用例：search citation、highlight citation）、`src/agent/runtime/embedded-runtime.test.ts`（2 个 resolveChapterHref 用例）。
- spec 约定：`.trellis/spec/frontend/state-management.md` 第 43-46 行描述可点工具引用段落，需同步删除。
- 历史会话 JSONL 里已存的引用数据不会受影响（只是不再渲染可点行）。

## Requirements

- **R1** 工具结果不再渲染可点击引用行。`search_in_book` / `read_chapter` / `list_annotations` 的工具卡只保留展开/收起和结果预览。
- **R2** `list_annotations` 工具本身、`search_in_book`、`read_chapter` 均保留，模型行为不变。
- **R3** 删除因本改动而成为孤儿的代码：`tool-citations.ts` 及其测试、`embedded-runtime.ts` 的 `resolveChapterHref`（含测试）、i18n `chat.citation.*` 键、App 中 `handleOpenCitation` 与 `onOpenCitation` 传递链。
- **R4** 不触碰目录、进度条、标注抽屉自己的跳转语义（`goToChapterHref` / `jumpToAnnotation` / `goToTocItem` 保留）。
- **R5** 更新 `.trellis/spec/frontend/state-management.md` 中的引用段落，与新的行为一致。

## Out of Scope

- 移除 `list_annotations` 工具本身（保留，仅去掉可点跳转）。
- 改动 `search_in_book` / `read_chapter` 的结果形状或模型提示词。
- 修改历史会话数据。

## Acceptance Criteria

- [ ] AC1 `search_in_book` / `read_chapter` / `list_annotations` 的工具卡不再出现可点击引用行，只有展开/收起与结果预览。
- [ ] AC2 `list_annotations` 工具仍可被助手调用并返回书签/高亮（只读，行为不变）。
- [ ] AC3 目录、上一章/下一章、标注抽屉的跳转功能正常（回归无破坏）。
- [ ] AC4 无孤儿代码：`tool-citations.ts`、`resolveChapterHref`、`chat.citation.*` i18n 键全部删除，代码库中无残留引用。
- [ ] AC5 `npm run test`（或项目既有测试命令）全绿，引用相关测试用例已删除或改写。
- [ ] AC6 `.trellis/spec/frontend/state-management.md` 引用段落已更新。
