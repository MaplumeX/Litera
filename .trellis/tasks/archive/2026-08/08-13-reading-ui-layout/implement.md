# Implement: reading UI layout (option B)

## Checklist

1. **顶栏 + 进度**（`src/App.tsx`）
   - 去掉阅读页 `Litera`。书名作为唯一标题。
   - 图标组：目录 / 字体 / 对话，激活态 `secondary`。
   - `ReaderProgressBar` 移到 header 下方通栏。

2. **目录抽屉**（`src/App.tsx` + 必要时 `TocSidebar.tsx`）
   - 删除 `w-56 shrink-0` 第三列。
   - 阅读区 overlay：抽屉 + 点击关闭的遮罩；Esc 关；点章节跳转后关。
   - `handleBackToLibrary` 不再 `setTocVisible(false)`。

3. **对话折叠**（`src/App.tsx`）
   - `chatCollapsed` 初值 `true`。
   - `ReaderView` 只保留一份，禁止折叠切换时双份 mount。
   - `ChatPanel` 收起时 hidden 但仍挂载；展开时 `Group` 默认约 `78/22`。
   - `handleSelectionCapture`：先展开再 `fillInput`（pending ref 兜底）。

4. **回归**
   - 设置入口、键盘翻页、回书库 flush、选段引用条，不顺手改 Chat 内部样式。

## Validation

```bash
npm test
npm run build
```

手动（实现后主会话或检查阶段）：

- 冷启动打开书：正文全宽，无 Litera，进度在顶栏下。
- 开目录：盖在正文上，点章节跳转并关闭；点遮罩关闭。
- 开对话：约 1/4 宽，可拖，再收起全宽。
- 开着对话回书库再打开书：对话仍开。重启后再打开：对话收起。
- 收起时选段「问 agent」：面板打开且输入框有选段。

## Risky files

- `src/App.tsx`：布局与开关全在这里，回归面最大。
- `ReaderView` 双份 mount：改不好会丢进度或闪白。

## Rollback

还原 `App.tsx` 阅读区 JSX 即可；无数据迁移。

## Before start

- `prd.md` / `design.md` / 本文件已评审。
- `implement.jsonl` / `check.jsonl` 已有真实 spec 条目。
- 用户明确批准本轮规划摘要后才 `task.py start`。
