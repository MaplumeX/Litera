# Implement: read_chapter 结构化 Markdown 投影

## Checklist

1. [ ] `src/agent/book/epub-content.ts`：
   - `Segment` 增加 `markdown?: string`；`parseSpineSegments` 同一次
     DOM walk 产出 `text`（不变）与 `markdown`（新 `markdownText` walk）。
   - 实现 `markdownText` 投影规则（design.md §2 表格）：块级段落/标题/
     引用/列表/`<pre>`，行内 em/strong/del，透明元素，空输出元素。
   - `Chapter` 增加 `markdown`；`buildOwnedChapters` bucket 收集
     `markdowns`，缺失时以 `text` 兜底。
   - `readChapter()`：窗口切分改用 `chapterWindows(chapter.markdown)`
  段落对齐装箱（design.md §7），`totalParts` = 窗口数，clamp 不变。
   - `bookToc` 的 `chars` 改为 `chapter.markdown.length`。
   - `searchBook` / `buildTrigramIndex` 不动（仍用 `chapter.text`）。
2. [ ] `src/agent/runtime/embedded-runtime.ts`：`read_chapter` 的
   `description` 更新，说明返回 Markdown。
3. [ ] `src/agent/book/epub-content.test.ts`：
   - 新增 `markdownText` 单测（块级、行内、pre 保留换行、列表、引用、
     标题、未知元素透明、fallback）。
   - union 不变量测试：新增「markdown 剥离标记后与扁平 text dense
     相等」断言。
   - 新增 `chapterWindows` 单测：段落装箱、边界恰好 12k、超长单段硬切、
     窗口按序 join 还原原文、空章节。
   - 更新受影响断言（`chars`、`readChapter().text` 含 Markdown 的
     fixture 期望值）。
4. [ ] `src/agent/runtime/embedded-runtime.test.ts`：如工具 description
   有断言则更新（预计无）。
5. [ ] `.trellis/spec/backend/quality-guidelines.md`：更新
   `read_chapter` 段落——返回结构化 Markdown、`chars` 语义、索引用
   扁平文本。

## Validation Commands

```bash
npm test                # vitest 全量
npx tsc --noEmit        # 类型检查
```

## Review Gates

- 每步完成后运行验证命令；union 不变量测试必须全绿。
- 检查搜索路径零改动：`searchBook`/`trigramIndex` 仍基于扁平 text。

## Rollback Points

- 步骤 1 独立成 commit 前，全部改动仅在 `epub-content.ts` + 测试；
  出问题直接 revert 该次改动即可，无数据迁移。