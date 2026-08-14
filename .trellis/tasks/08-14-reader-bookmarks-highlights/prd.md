# Reader bookmarks and highlights

## Parent

`08-14-reader-annotate-and-progress`

## Goal

读者能钉住当前页、划出单色高亮，并从标注抽屉跳转或删除。不做笔记、不多色。

## User Value

选中不再只能问助手。想回到某一页或某一句，有自己的书签和高亮。

## Background / Confirmed Facts

- 父任务 MVP：书签 + 单色高亮；顶栏「标注」打开左侧覆盖抽屉；加书签在抽屉顶部；选中浮层加「高亮」、保留「问 agent」。
- 定位与绘制见父任务 `research/foliate-annotations.md`。持久化见 `research/annotation-persistence.md`。
- `BookRecord` / `library.json` 是 `deny_unknown_fields`。标注必须放在 `books/<id>/annotations.json`，不能写进书库记录。
- 选区必须从章节 iframe `doc.getSelection()` 取。`window.getSelection()` 对高亮 CFI 不可靠。
- 覆盖导入不碰 `books/<id>/` 里的额外文件；删除书会整目录带走。
- 目录抽屉已是覆盖层。标注抽屉复用同一形态，与目录互斥。

## Requirements

### 书签

- 标注抽屉顶部「添加书签」钉当前阅读位置（`relocate` 的 cfi + fraction + 可选章节名）。
- 同一 CFI 已存在则不再加一条。
- 列表可跳转、可删除。重开应用仍在。
- 覆盖同一本书后记录仍在。删除该书后消失。

### 高亮

- 选中浮层有「高亮」和「问 agent」。
- 单色画在原文上；翻页、重开书后仍在（`create-overlay` 时重新 `addAnnotation`）。
- 列表显示摘录，可跳转、可删除；删除后原文颜色消失。
- 覆盖后记录仍在（对不上的 CFI 可以画不出）。删除该书后消失。

### 抽屉

- 顶栏「标注」在目录和字体之间。激活态与目录相同。
- 左侧覆盖抽屉，分书签 / 高亮两段，空段有空状态。
- 与目录互斥。点遮罩、Esc、再点按钮、或点列表跳转后关闭。
- 开闭只活在进程里。不写磁盘。

### 既有行为

- 「问 agent」在对话收起时仍先展开再填入。
- 不改 sidecar、不改 `library.json` schema。

## Acceptance Criteria

- [ ] 能给当前位置加书签；重开该书后仍在；点击跳回。
- [ ] 能删除书签。
- [ ] 选中能加单色高亮；翻页和重开后原文上仍有颜色。
- [ ] 能从列表跳到高亮并删除；删除后颜色消失。
- [ ] 浮层同时有「高亮」和「问 agent」；问 agent 行为与现在一致。
- [ ] 顶栏「标注」打开覆盖抽屉，与目录互斥，不永久挤窄正文。
- [ ] 没有笔记、多色、导出。
- [ ] 覆盖同一本书后标注记录仍在；删除书后不再出现。
- [ ] `library.json` / `BookRecord` 没有新字段。
- [ ] `npm test` + `npm run build` 通过。

## Out of Scope

- 进度条（兄弟任务）
- 多色、笔记、导出、书内搜索
- 点击正文高亮弹出菜单（列表删除即可）
- sidecar / agent

## Dependencies

进度条 child 不是硬依赖。若进度条已合并，标注跳转应带动细条更新（走现有 `relocate`）。
