# 修复重复打开书籍导致翻页失效

## Goal

系统通过「打开方式」打开一本已在书库的 EPUB 时,阅读器翻页无法正常显示(可见内容不动,翻页效果发生在不可见的渲染器上)。修复后:系统打开已在书库的书直接进入阅读器、不再显示多余的「已在书库」banner,且任何重复打开路径都不会再堆叠 foliate 渲染器。

## Background / Confirmed Facts

- 系统打开已在书库的 EPUB 的完整链路(`src/lib/open-paths.ts` 的 `drain()`):
  1. `importPaths(paths)` → 后端 `import_bytes` 返回 `duplicate` → 前端显示「《title》已在书库」banner(带「打开」按钮)
  2. `if (!disposed && last) await dependencies.openBook(last)` → **自动打开这本书**(进入阅读器)
  3. 用户再点 banner 的「打开」按钮 → **第二次** `handleOpenBook`
- `handleOpenBook`(`src/App.tsx:309`)每次都会 `setFileData(...)`(新对象引用),触发 ReaderView 的 `[fileData, initialFraction]` effect 重新执行 `view.open(file)`(`src/components/ReaderView.tsx`)。
- foliate-view 的 `open()`(`src/foliate-js/view.js:233`)创建新的 `foliate-paginator` 并 `#root.append(this.renderer)`,**不清理旧 renderer**;只有 `close()` 才调用 `renderer.destroy()` + `remove()`。
- 结果:shadow root 堆叠两个 `foliate-paginator`(都 `height:100%`)。可见的是第一个(首次 open 的书),翻页操作 `view.next()` 作用在第二个(屏幕外被裁剪)→ 翻页无法正常显示。
- 从书库点封面打开时 `view === "library"` 且 `fileData === null`(`handleBackToLibrary` 会清空),每次都是全新打开,不会堆叠;堆叠只发生在「同一 reader 视图内重复 setFileData」的路径。
- `importFromPaths`(`src/lib/use-book-import.ts:83`)被两处使用:拖放(`LibraryView.tsx`)和系统打开(`App.tsx` 的 `useOpenPaths`)。拖放场景的 duplicate banner + 「打开」按钮是有意义的(用户主动导入重复文件),系统打开场景书已自动打开、banner 多余。

## Requirements

- **R1** 系统打开已在书库的 EPUB:自动打开该书进入阅读器,**不显示**「已在书库」banner(含「打开」按钮)。
- **R2** 拖放 / 文件选择器导入重复文件:仍显示「已在书库」banner + 「打开」按钮(现有行为不变)。
- **R3** 同一 reader 视图内任何重复打开(重复 `setFileData`):不堆叠 foliate renderer,翻页始终正常。
- **R4** 从书库点封面打开、系统打开新书、overwrite 确认后打开:行为不变。
- **R5** 不改变后端 `import_bytes` 的 `duplicate` 分类逻辑;修复全部在前端。

## Acceptance Criteria

- [ ] AC1. 系统打开一本已在书库的 EPUB:自动进入阅读器,无「已在书库」banner,翻页(点击/滚轮/方向键)正常。
- [ ] AC2. 拖放一本重复 EPUB:显示「已在书库」banner + 「打开」按钮,点击「打开」进入阅读器且翻页正常。
- [ ] AC3. 同一本书在 reader 视图内被连续打开两次(模拟重复 `setFileData`):不堆叠 renderer,翻页始终正常。
- [ ] AC4. 从书库点封面打开、系统打开新书、overwrite 确认后打开:行为与修复前一致。
- [ ] AC5. 新增/更新测试覆盖:duplicate 在 `suppressDuplicateNotice` 下不产生 banner;现有 `book-import`、`open-paths`、`LibraryView` 测试全部通过。

## Out of Scope

- 修改后端 `import_bytes` 的 `duplicate` / `overwrite` / `new` 分类逻辑。
- 修改「已在书库」banner 的文案或样式。
- 修改 foliate-js 源码(通过调用方 `close()` 防御,不 patch submodule)。
- 启动时自动恢复上次阅读的书。

## Decisions

- 系统打开路径的 duplicate **整个 banner 都不显示**(不只是去掉「打开」按钮):书已自动打开,「已在书库」提示无意义。
- 防御性修复放在 ReaderView 的 open effect:`view.open(file)` 前先 `view.close?.()`。这是最根本的修复,覆盖所有重复 open 路径(包括未来新增的)。
- 不做 `handleOpenBook` 的 bookId 去重:正常流程中 `view === "library"` 时 `fileData` 必为 null,去重不会命中;banner 按钮移除后触发堆叠的路径已消失,防御性 close 已足够。
- 通过 `ProcessImportDeps` 新增 `suppressDuplicateNotice?: boolean` 选项实现 R1/R2 分流,默认 `false` 保持现有行为。

## Technical Notes

- `processImportResults`(`src/lib/book-import.ts:63`)的 duplicate 分支:`if (!deps.suppressDuplicateNotice) deps.onNotice({...})`,`successfulBookIds.push` 不变。
- `importAbsolutePaths` 透传 deps;`useBookImport.importFromPaths` 签名扩展为 `(paths, options?: { suppressDuplicateNotice?: boolean })`,透传给 `importAbsolutePaths`。
- `App.tsx` 的 `useOpenPaths` 调用处:`importPaths: (paths) => bookImport.importFromPaths(paths, { suppressDuplicateNotice: true })`。
- ReaderView open effect(`src/components/ReaderView.tsx`):`view.open(file)` 前加 `(view as unknown as { close?: () => void }).close?.()`。
