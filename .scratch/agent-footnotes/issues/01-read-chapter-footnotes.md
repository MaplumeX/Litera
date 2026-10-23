# 01: read_chapter 输出 Markdown 脚注

**What to build:** 按 `spec.md` 在 `src/agent/book/epub-content.ts` 中识别脚注引用，`read_chapter` 的每个 part 把注号渲染为 `[^label]` 并在末尾追加对应定义；系统提示词说明这一格式。

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] `epub:type="noteref"`、`sup > a`、`a > sup` 注号渲染为 `[^label]`，不再切分段落
- [x] 同文件 `<aside epub:type="footnote">` 注释作为定义追加到引用它的 part 末尾
- [x] 跨文件尾注（注释文件里 `<p><a id href=回链>[1]</a>…</p>`）作为定义追加，回链被剥掉
- [x] 回链本身不被当作注号
- [x] 扁平文本保留注号原文；Markdown 不因注号退回扁平文本
- [x] `locateQuote` 忽略 `[^label]`
- [x] 系统提示词说明脚注格式

## Comments

- 实现于 `src/agent/book/epub-content.ts`（`annotateFootnotes` / `withFootnotes` / `withFootnoteDefinitions`）。相对 spec 的补充：
  - `resolveHref` 对纯 `#fragment` 链接会丢掉当前文件，脚注检测里单独处理。
  - 回链除了 `role="doc-backlink"` / 成对候选外，还包括注释里任何指回注号（或其所在块）的链接，如 `<a href="c1.xhtml#r2">[2]</a>`。
  - 列表/表格里的注释目标（pandoc 的 `section.footnotes > ol > li#fn1`）不再作为锚点：Markdown 遍历把整个 `ol` 当一个块，原先这些锚点让切片错位、整段退回扁平文本。
- 9 本本地真实书籍验证：注号 0 个未解析；扁平文本去空白后与改动前一致；退回扁平文本的字符数全部下降（《君主论》132k→15k，《资本主义发展论》76k→1.5k，《黑格尔小逻辑绎注》47k→1.3k）。剩余退回是与脚注无关的既有问题（正文自带 `1.` 编号、标题内锚点等）。
