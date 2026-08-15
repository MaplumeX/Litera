# Implement: 修复重复打开书籍导致翻页失效

## 执行清单

1. **`src/lib/book-import.ts`**
   - `ProcessImportDeps` 新增 `suppressDuplicateNotice?: boolean`
   - `processImportResults` duplicate 分支:`if (!deps.suppressDuplicateNotice) deps.onNotice({...})`;`successfulBookIds.push` 不变

2. **`src/lib/use-book-import.ts`**
   - `importFromPaths` 签名:`(paths: string[], options?: { suppressDuplicateNotice?: boolean })`
   - 透传:`importAbsolutePaths(paths, { askConfirm, onNotice: pushNotice, suppressDuplicateNotice: options?.suppressDuplicateNotice })`

3. **`src/App.tsx`**
   - `useOpenPaths` 的 `importPaths`:`(paths) => bookImport.importFromPaths(paths, { suppressDuplicateNotice: true })`

4. **`src/components/ReaderView.tsx`**
   - open effect:`view.open(file)` 前加 `view.close?.()`(类型上补 `close?: () => void`)

5. **测试 `src/lib/book-import.test.ts`**
   - 新增:duplicate + `suppressDuplicateNotice: true` → `onNotice` 不被调用,返回 `["book-1"]`
   - 新增:duplicate + 默认(不带 options)→ 仍产生 notice(现有用例已覆盖,可复用)

## 验证命令

```bash
# 前端单测
npx vitest run src/lib/book-import.test.ts src/lib/open-paths.test.ts src/components/LibraryView.test.tsx

# 全量前端单测
npx vitest run

# 类型检查
npx tsc --noEmit

# 构建(可选,确认无打包问题)
npm run build
```

## 审查门

- [ ] duplicate 在 `suppressDuplicateNotice` 下不产生 banner,但 `successfulBookIds` 仍含该书(open-paths 自动打开依赖此返回值)
- [ ] 拖放/文件选择器路径不带 options,行为不变
- [ ] ReaderView open effect 先 `close()` 再 `open()`,无重复 renderer 堆叠
- [ ] 后端与 foliate-js submodule 零改动

## 回滚点

- 改动全部在前端 4 个文件 + 1 个测试文件,`git checkout -- <file>` 即可回滚
- 无数据库/存储迁移,无后端行为变化
