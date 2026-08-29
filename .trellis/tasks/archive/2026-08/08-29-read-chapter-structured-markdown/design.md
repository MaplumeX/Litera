# Design: read_chapter 结构化 Markdown 投影

## 目标回顾

`chapter.text` 从扁平纯文本（`/\s+/g → " "` 合并、段落丢弃）变为结构化
Markdown。见 prd.md R1–R9。

## 现状数据流

```
parseEpub (epub-content.ts)
  spineHrefs → parseSpineSegments(fileText) → Segment[]          # anchor 切分
  buildOwnedChapters(toc, spineHrefs, spineSegments) → Chapter[] # ownership
    chapter.text = bucket.texts.join("")                          # 扁平文本
  buildTrigramIndex(chapters)                                     # 搜索索引
readChapter(book, i, part) → 12k 窗口切片
searchBook(book, queries) → 命中 + ±160 字符 snippet
```

## 方案

### 1. 每个结构承载两份投影

`Segment` 增加字段：

```ts
export interface Segment {
  anchorId?: string;
  text: string;      // 扁平纯文本（现状语义，不变）
  markdown?: string; // 结构化 Markdown（新增）
}
```

`Chapter` 同样增加 `markdown` 字段（`markdowns: string[]` bucket +
`text`）。`parseSpineSegments` 的 DOM walk 同时产出两份投影：

- `text`：现有 `visit` 逻辑，语义完全不动（anchor 边界、空白折叠、
  trim 规则），保证 ownership 判定与 union 不变量零风险。
- `markdown`：同一棵 DOM 的新 walk（`markdownText`），规则见下。

两份投影由**同一次 DOM 遍历**产生，anchor 边界天然一致；不引入第二套
解析。

### 2. Markdown 投影规则（markdownText）

块级（产出段落，块间以 `\n\n` 连接）：

| 元素 | 输出 |
|---|---|
| `<p>`, `<div>`, `<section>`, `<header>`, `<footer>`, `<aside>`（无脚注语义）| 块文本（普通段落） |
| `<h1>`..`<h6>` | `# ` .. `###### ` + 块文本 |
| `<blockquote>` | 块文本每行加 `> ` 前缀 |
| `<ul>/<ol>` | `- item` / `1. item`；嵌套列表缩进两个空格；松散列表项内容按块处理 |
| `<pre>` | 内容按原始文本节点逐字保留，`<br/>` → `\n`，不折叠空白，不转义 |
| `<table>` 及内部 | 降级为普通块文本（本次不做 Markdown 表格） |
| 其他未知元素 | 透明：只递归子节点，不产出自己的块 |

行内（段内，空白折叠同现状）：

| 元素 | 输出 |
|---|---|
| `<em>`, `<i>` | `*…*` |
| `<strong>`, `<b>` | `**…**` |
| `<del>`, `<s>`, `<strike>` | `~~…~~` |
| `<sup>`/`<sub>`/`<code>`/`<span>`/`<a>`（链接文本）| 透明（纯文本内容） |
| `<img>`/`<svg>`/`<audio>`/`<video>` | 空输出（不提取 alt） |
| `<br/>` | 段内换行 `\n`（不打断段落） |

段落内连续空白仍折叠为单空格（`<pre>` 除外），段边界 trim。行内标记
与文字之间不加空格。

### 3. 数据结构变化

```ts
interface Chapter {
  ...
  text: string;      // 扁平（现状）
  markdown: string;  // 结构化（新增；缺失时回退 text）
}
```

`buildOwnedChapters` 的 bucket 增加 `markdowns: string[]`；segment 无
markdown 时（fallback 纯文本）以 `text` 兜底，保证 `markdown` 字段总是
存在（`markdown ?? text`）。

`ParsedBook` 无形状变化。

### 4. 下游使用

- `readChapter()`：窗口切分改为**段落对齐装箱**（见 §7），返回的
  `text` 字段承载 Markdown 窗口（字段名不变，见 Contracts）。
- `bookToc()`：`chars` 统计 `chapter.markdown.length`（诚实反映模型
  实际读到的总长）。
- `buildTrigramIndex` / `searchBook`：继续基于 `chapter.text`（扁平），
  snippet、`part`（`Math.floor(offset / CHAPTER_PART_CHARS)`）继续用
  扁平文本的偏移量，保持现状近似值（文档注明：Markdown 窗口可能比
  近似值多 1，agent 用 `part` 附近窗口即可）。**搜索路径零改动。**
- `BookContentPort.readChapter` 返回形状不变（`text: string`），仅值
  的格式变化。

### 5. 工具面（embedded-runtime.ts）

- `read_chapter` 的 `description` 更新为
  `"Read a chapter window in Markdown (paragraphs, headings, emphasis)"`
  （或等义英文），其余工具不动。
- `BookWorkerClient` / `epub.worker.ts`：消息协议形状不变
  （`readChapter` 结果直接透传），无需改 worker RPC。

### 7. 段落对齐窗口装箱

新增纯函数（`epub-content.ts`）：

```ts
function chapterWindows(markdown: string): string[]
```

- 按 `\n\n` 把 `markdown` 拆成段落块（保留顺序，块间连接符就是
  `\n\n`）。
- 贪心装箱：从第一块开始累积，`current.length + 2 + next.length <=
  CHAPTER_PART_CHARS` 则并入当前窗口，否则封当前窗口、`next` 开新窗口。
- 单块自身超过 12k（罕见，如超长 `<pre>`）：该块再按 12k 硬切成
  连续子串，末尾残余块继续作为装箱当前窗口与后续段落合并（避免
  「[12000, 囊末残余, 小段]」的浪费模式）。
- 结果保证：除硬切引入的边界外，所有窗口按序 `join("\n\n")` 还原
  原 markdown；超长块的各片段是它的精确连续切片；每个窗口 ≤ 12k；
  仅硬切超长段的窗口边界可能切断内容。
- `readChapter()`：`chapterWindows(chapter.markdown)` 得到窗口数组，
  `totalParts = windows.length`（空章节 = 1 个空窗口），`part` clamp
  到 `[0, totalParts-1]`，返回对应窗口。O(章长)，每次调用现算，
  不需要缓存（章节 MB 级、调用低频）。

## Contracts

- `Segment { anchorId?, text, markdown? }`
- `Chapter { label, ancestors, depth, hrefs, text, markdown }`
- `bookToc()` `chars` = markdown 长度
- `readChapter()` 返回 `{ chapterIndex, chapterNumber, part, totalParts, text }`
  — `text` 内容为 Markdown 窗口

### 8. 回退与错误处理

- `parseSpineSegments` try/catch 现状保留：DOM 解析失败 → 单个
  `htmlText` 纯文本 segment（无 markdown → 下游 `text` 兜底）。
- markdown walk 或装箱抛错（理论上不应发生）：catch 后降级为 `text`
  硬切窗口（现状语义）。

## 性能与内存

- 每章多存一份投影，内存约 ×2（章节文本量级为 MB 级，可接受）。
- parse 时间增加一次 DOM walk（同一棵树），O(n) 常数级，可接受。
- `chapterWindows` 每次 `readChapter` 调用现算 O(章长)；窗口均为完整
  Markdown，不再出现标记被切半的情况。

## 兼容性 / 回滚

- 单一 commit 涉及 `epub-content.ts`（投影）+ `book-content.ts`（若
  BookTocEntry 语义文档需同步）+ `embedded-runtime.ts`（description）。
- 测试基线：现有 union/ownership 测试直接迁移（期望文本多为单段无结构
  标签 fixture，多数断言不变；少数含 `<p>` 的 fixture 期望值需更新为
  Markdown 格式或改用剥离断言）。
- 回滚 = revert 单 commit；无持久化数据迁移（会话 JSONL 存的是当时的
  工具结果文本，不回填）。

## 测试策略

- 新增 `markdownText` 单测：块级/行内/`<pre>`/列表/引用/标题/未知元素
  透明/fallback。
- union 不变量测试改造：`chapter.markdown` 剥离 Markdown 标记后与
  `chapter.text`（扁平）逐字符 dense 相等（新增断言，不动旧断言）。
- `readChapter` 窗口测试：markdown 长度驱动 `totalParts`。
- 既有测试全量跑（`npm test`、`tsc --noEmit`）。