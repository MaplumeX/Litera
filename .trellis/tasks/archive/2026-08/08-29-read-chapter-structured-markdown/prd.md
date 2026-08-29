# read_chapter 返回带结构 Markdown 而非纯文本

## Goal

`read_chapter` 工具返回的章节文本从「完全压平的单行纯文本」改为保留 XHTML 结构的
Markdown：段落边界、标题层级、行内强调、块级引用/列表/预格式块都能被 agent
读到。agent 因此能区分对话与叙述、理解标题层级、识别强调与引用，回答更准确。

## Background / Confirmed Facts

- 现有投影在 `src/agent/book/epub-content.ts`：`parseSpineSegments` /
  `htmlText` 用 `.replace(/\s+/g, " ")` 合并所有空白，元素文本直接拼接，
  段落/标题/强调结构全部丢失。该投影同时服务于：
  - `chapter.text` → `read_chapter`（12k 字符窗口切分）
  - trigram 搜索索引 + `search_in_book` snippet（±160 字符摘录）
  - `get_toc` 的 `chars` 统计
- 章节归属（anchor 切分、TOC ownership）基于「文本 union 不变量」：
  union of chapter texts == union of spine texts。结构化投影不得破坏此不变量。
- 用户已确认范围：层次 1–4（段落、标题、行内语义、块级元素）全部要，脚注
  （noteref/aside）不在本次范围；输出格式为 **Markdown**。
- 工具 schema（`embedded-runtime.ts` `tools()`）与 `BookContentPort` 契约
  形状不变（仍返回 `text` 字符串），仅内容格式变化。
- 阅读器渲染路径（foliate）与此投影完全独立，不受影响。

## Requirements

1. **R1 段落结构** — 块级元素边界产生 `\n\n`（段落分隔）。连续空白在段内
   仍折叠为单空格。
2. **R2 标题结构** — `<h1>`~`<h6>` 映射为 `# `~`###### ` Markdown 标题。
3. **R3 行内语义** — `<em>`/`<i>` → `*…*`，`<strong>`/`<b>` → `**…****`，
   `<del>`/`<s>`/`<strike>` → `~~…~~`。行内标记内的文本同样参与空白折叠。
4. **R4 块级元素** — `<blockquote>` → `> ` 前缀；`<ul>/<ol>/<li>` →
   Markdown 列表；`<pre>` 内容原样保留换行（`<br/>` → `\n`），不折叠空白。
5. **R5 不变量保持** — 章节归属/anchor 切分仍精确；union 不变量成立
   （去掉 Markdown 标记后的正文文本，union 与旧纯文本一致）。
6. **R6 段落对齐窗口切分** — 窗口不再在固定字符处硬切：每章将 Markdown
   按 `\n\n` 拆成段落块，贪心装箱为 ≤ `CHAPTER_PART_CHARS`（12k）的窗口；
   超过 12k 的单段才硬切。每个窗口是完整合法的 Markdown（无残缺标记）。
   `part`/`totalParts` 语义不变（窗口序号/窗口总数），
   `get_toc` `chars` 统计的是结构化文本总长。搜索结果里的 `part` 保持
   现状近似值（扁平偏移 ÷ 12k），文档注明。
7. **R7 搜索兼容** — trigram 索引与 `search_in_book` 基于**扁平纯文本**
   （从结构化文本剥离 Markdown 标记得到），snippet 输出也用扁平文本，
   保持摘录可读、偏移量与命中位置一致。
8. **R8 工具面不变** — 工具名、参数 schema、返回 JSON 形状不变；
   `read_chapter` 的 `description` 更新为说明内容是 Markdown。
9. **R9 回退安全** — 现有 fallback（解析失败 → `htmlText` 纯文本）语义保留，
   空章节仍为空。

## Out of Scope

- 脚注（noteref/`epub:type` aside）的结构化——保持现状按普通文本处理。
- 表格（`<table>`）→ Markdown 表格。按普通段落文本处理。
- 阅读器渲染路径（foliate）的任何改动。
- 图片/`<image>`/`<svg>` 的 alt 文本提取。
- `search_in_book` 的返回形状或匹配算法改动（仅 snippet 数据源变化）。
- 系统提示词中除 `read_chapter` description 外的措辞调整。

## Acceptance Criteria

- [ ] AC1 结构化投影：含 `<p>`/`<h1>`-`<h3>`/`<em>`/`<strong>`/`<blockquote>`/
  `<ul>`/`<pre>` 的 fixture EPUB，`read_chapter` 输出含对应 Markdown
  结构（`\n\n` 分段、`#`/`##`/`###` 标题、`*em*`、`**strong**`、`>` 引用、
  `- ` 列表、保留换行的代码块）。
- [ ] AC2 不变量：对既有所有 fixture（epub-content.test.ts），去掉结构标记后
  章节文本 union 与 spine 文本 union 相等（测试断言逐对比较或以既有
  union 测试改造）。
- [ ] AC3 归属正确：既有 anchor 切分/TOC ownership 测试在新投影下全绿
  （可能需按新格式更新断言中的期望文本）。
- [ ] AC4 搜索：结构化投影下，exact/partial 搜索命中与 snippet 与扁平文本
  期望一致（搜索基于剥离标记后的扁平文本）。
- [ ] AC5 窗口切分：`chars` 为 markdown 总长；`totalParts` 由段落装箱
  结果决定；每个窗口 ≤ 12k 且为完整 Markdown；超长单段硬切；空章节
  `totalParts=1`、`part` clamp 行为与现状一致。
- [ ] AC6 回退：解析失败 fixture（非 XML 输入等）回退纯文本，不抛错。
- [ ] AC7 工具描述：`read_chapter` `description` 提到 Markdown。
- [ ] AC8 前端 `npm test`（vitest 全量）+ `tsc --noEmit` 通过。

## Risks / Open Questions

- Markdown 标记混入搜索索引的风险已通过 R7（索引用扁平文本）规避。
- `<pre>` 内嵌行内标签（如 `<code>`）按普通行内文本处理（不做反引号包裹）。