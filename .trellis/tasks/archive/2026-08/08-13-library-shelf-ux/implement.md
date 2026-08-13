# Implement: Library shelf loop and import-delete UX

## Checklist

1. **Record fields + open context**
   - `BookRecord` 增加 `lastOpenedAt`、`contentHash`（`serde(default)` + 校验）。
   - TS `BookRecord` / `BookOpenContext` 同步。
   - `get_book_open_context` 返回 `title`；缺 hash 时补写。
   - `open_book_bytes` 成功后写 `lastOpenedAt`。
   - `list_books` 按 design 排序。
   - `App.tsx` 用 context.title 填顶栏。
   - Rust 测试：旧 JSON 能读；打开后排序变化；title 不再是空/`book.epub`。

2. **卡片进度**
   - `BookCard`：有 `lastFraction` 时封面底条 + 百分比；没有则不渲染。

3. **导入分类：覆盖 / 指纹去重**
   - 加入 `sha2` 直接依赖。
   - `import_bytes` 按 design 返回 `new | overwrite | duplicate`。
   - `import_book` 改为 `pick_files`，返回 `ImportBookResult[]`。
   - 新增 `import_paths`、`discard_import`。
   - `save_book_metadata` 写入 hash，覆盖时保留进度/设置/lastOpenedAt。
   - Rust 测试：同路径需确认；同内容不同路径不建第二本；取消覆盖后 pending 消失且旧书完好。

4. **LibraryView 导入 UX**
   - 循环处理结果数组：new 直接抽元数据；overwrite 先 AlertDialog；duplicate 出 banner + 打开。
   - 拖放：`onDragDropEvent` → `import_paths`。忽略非 epub。
   - 导入失败用 banner，不用 `alert()`。

5. **删除确认 + 会话目录**
   - `npx shadcn@latest add alert-dialog`。
   - 单本 / 批量共用确认框。
   - `delete_book` 提交后删 `sessions/<bookId>/`。
   - Rust 测试：删书后会话目录不在；取消不调用删除。

6. **选择模式**
   - 工具栏「选择」/「取消」/「删除」+ 已选数量。
   - 选择模式下封面点击只切换勾选。
   - 删完或取消后退出选择模式。

## Validation

```bash
cd src-tauri && cargo test
npm test
npm run build
```

手动（实现后、声明完成前）：

- 打开已有书：顶栏是书名；返回书库后该书在最前；卡片有进度。
- 从未打开的书：无 0%。
- 拖入 / 多选导入若干 epub。
- 同一文件再选一次：确认覆盖后进度还在；取消后仍是旧书。
- 复制到另一路径再导入：提示已在书库，网格不增一本。
- 选择模式删两本：确认文案含数量和对话；两本与其 `sessions/<id>/` 消失。
- 打开书后问答、翻页、主题仍可用。

## Risky files

- `src-tauri/src/library.rs` — 导入事务、校验、删除。
- `src/components/LibraryView.tsx` / `BookCard.tsx` — 选择模式与拖放。
- `src/App.tsx` — 打开书标题。
- `src-tauri/Cargo.toml` — 新增 `sha2`。

回滚点：每个 checklist 项单独可编译。导入分类与选择模式不要和字段改动缠在同一个无法还原的提交里。

## Before `task.py start`

- [x] `prd.md` 已收敛，无阻塞 Open Questions
- [x] `design.md` / `implement.md` 已写
- [x] `implement.jsonl` / `check.jsonl` 有真实 spec 条目
- [ ] 用户批准本规划摘要后才能 `task.py start`
