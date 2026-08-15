# Design: 修复重复打开书籍导致翻页失效

## 问题模型

```
系统打开已在书库的 EPUB
  → import_paths → duplicate → banner「已在书库」+「打开」按钮
  → open-paths drain() 自动 openBook(进入 reader,fileData 设置)
  → 用户点 banner「打开」→ 第二次 handleOpenBook → setFileData(新引用)
  → ReaderView [fileData] effect 再次 view.open(file)
  → foliate-view.open() 创建新 foliate-paginator 并 append,旧 renderer 未清理
  → shadow root 堆叠两个 paginator:可见第一个,翻页作用第二个(屏幕外)
```

## 修复策略(两层)

### 1. 消除触发路径(UX 层)

系统打开路径的 duplicate 不再显示 banner。书已自动打开,提示无意义。

**改动点:**

- `src/lib/book-import.ts`:
  - `ProcessImportDeps` 新增可选字段 `suppressDuplicateNotice?: boolean`
  - `processImportResults` duplicate 分支:`if (!deps.suppressDuplicateNotice) deps.onNotice({...})`;`successfulBookIds.push` 不变(duplicate 仍算成功,open-paths 才能拿到 bookId 自动打开)
- `src/lib/use-book-import.ts`:
  - `importFromPaths` 签名扩展为 `(paths: string[], options?: { suppressDuplicateNotice?: boolean })`
  - 透传给 `importAbsolutePaths(paths, { ...deps, suppressDuplicateNotice: options?.suppressDuplicateNotice })`
- `src/App.tsx`:
  - `useOpenPaths` 的 `importPaths` 改为 `(paths) => bookImport.importFromPaths(paths, { suppressDuplicateNotice: true })`

**为什么不动 `importFromPicker`:** 文件选择器导入重复文件时用户是主动导入,banner + 「打开」按钮有意义(R2)。

**为什么不动拖放路径:** `LibraryView.tsx` 的 `handleDroppedPaths` 直接调 `importFromPaths(epubs)` 不带 options,默认 `false`,行为不变(R2)。

### 2. 防御性修复(渲染层)

ReaderView 的 open effect 在 `view.open(file)` 前先 `view.close?.()`:

```ts
const view = viewRef.current as unknown as {
  open: (file: File) => Promise<void>;
  init: (opts: Record<string, unknown>) => Promise<void>;
  goToFraction: (frac: number) => Promise<void>;
  close?: () => void;
};
...
view.close?.();  // 清理旧 renderer,防止堆叠
view.open(file).then(...)
```

foliate-view 的 `close()` 会 `renderer.destroy()` + `renderer.remove()`,之后 `open()` 创建新 renderer 并 append,shadow root 里始终只有一个 paginator。

**为什么不做 `handleOpenBook` 的 bookId 去重:** 正常流程中 `view === "library"` 时 `fileData` 必为 null(`handleBackToLibrary` 清空),去重条件 `fileData?.bookId === bookId && view === "reader"` 在正常路径不会命中;banner 按钮移除后触发堆叠的路径已消失,防御性 close 已覆盖所有未来路径。保持改动最小。

## 兼容性

- 后端零改动(R5)。
- foliate-js submodule 零改动(通过调用方 `close()` 防御)。
- `ProcessImportDeps` 新增可选字段,现有调用方(测试、`importFromPicker`)不受影响。
- `importFromPaths` 签名扩展为可选第二参数,现有调用方(`LibraryView.tsx` 拖放)不受影响。

## 测试影响

- `src/lib/book-import.test.ts`:新增用例「suppressDuplicateNotice 时 duplicate 不产生 notice 但仍返回 bookId」。
- `src/lib/open-paths.test.ts`:现有用例不涉及 banner,不受影响(open-paths 只关心 importPaths 返回值)。
- `src/components/LibraryView.test.tsx`:拖放/导入用例不带 options,行为不变,应全部通过。
- ReaderView 无直接单测(依赖 foliate 自定义元素),防御性 close 通过代码审查 + 手动验证覆盖。
