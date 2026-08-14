# Implement: same-path unchanged reimport

## Checklist

1. 在 `src-tauri/src/library.rs` `import_bytes` 中，backfill 之后把「`id == incoming book_id` 且 `contentHash == incoming_hash`」与现有异路径 hash 命中一样早返回 `ImportStatus::Duplicate`（无 `import_id`，不建 `.imports`）。
2. 新增 Rust 测试：同路径 + `b"version-one"` 再导入 → `Duplicate`、无 `import_id`、`.imports` 不出现、`last_fraction` / title / 已提交 EPUB 不变。
3. 保留并确认仍绿：
   - `same_path_reimport_is_overwrite_and_keeps_progress`（换内容）
   - `same_content_different_path_is_duplicate_and_does_not_stage`
   - `same_batch_new_then_same_content_is_duplicate`
4. 可选：在 `src/lib/book-import.test.ts` 不必加用例，除非分类结果形状变了（不应变）。
5. 实现完成后按 Phase 3.3 改 spec，不要在写代码时顺手改：
   - `.trellis/spec/backend/tauri-commands.md` Import classification：`duplicate` 包括同路径同哈希；`overwrite` 仅同路径且内容不同。
   - `.trellis/spec/backend/database-guidelines.md`：同路径未变是 no-op，不再写「Re-import is not a no-op」。

## Validation

```bash
cd src-tauri && cargo test --lib library
```

前端无合同变更时不必为这次强制跑 vitest；若动了 `book-import.ts` 再跑：

```bash
npx vitest run src/lib/book-import.test.ts src/lib/open-paths.test.ts
```

## Risks

- 在 backfill 之前比较哈希：缺 `contentHash` 的旧书会误报 overwrite。必须先 backfill。
- 为同路径未变仍 staging：取消覆盖会走 `discard_import`，用户会看到对话框。早返回必须发生在写 pending 之前。
- 不要用路径字符串相等代替 `book_id_for_source`；id 仍只由源路径哈希得出。

## Rollback

只回退 `import_bytes` 与对应测试。无数据迁移。
