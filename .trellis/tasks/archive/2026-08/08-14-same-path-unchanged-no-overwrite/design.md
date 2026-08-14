# Design: same-path unchanged reimport

## Boundary

只改 `LibraryStore::import_bytes` 的分类。`import_book`、`import_paths`、系统打开队列都已经调用它。前端 `processImportResults` 已把 `duplicate` 当成功且不调用 `save_book_metadata`。

不改 IPC 形状、不改 `ImportStatus`、不改暂存/提交协议。

## Classification

在 `backfill_missing_content_hashes` 之后、创建 `importId` / 写 `.imports` 之前：

| 条件 | status | 暂存 | `importId` |
|---|---|---|---|
| 存在 `id != incoming_id` 且 `contentHash == incoming` | `duplicate`（已有） | 否 | 无 |
| 存在 `id == incoming_id` 且 `contentHash == incoming` | `duplicate`（本次） | 否 | 无 |
| 存在 `id == incoming_id` 且哈希不同或（backfill 后仍）缺失 | `overwrite`（已有） | 是 | 有 |
| 否则 | `new`（已有） | 是 | 有 |

实现上把「同书 + 同哈希」并进现有 duplicate 早返回即可，不必先 `existed` 再分支。不要读第二遍磁盘：`incoming_hash` 已从传入 bytes 算出；对方哈希用记录里的 `contentHash`（缺的已由 backfill 写成）。

同路径未变的返回值与异路径 duplicate 相同：`book_id` / `title` 用已有记录，`import_id: None`。

## Why not a fourth status

系统打开已经把 `duplicate` 算成功并 `openBook`。再加 `unchanged` 要改 Rust、TS、i18n、两套测试，只为少一条「已在书库」提示。PRD R6 明确复用 `duplicate`。

## Compatibility

- 已入库且哈希已在：同路径未变不再写 pending 文件，也不会把 `contentVersion` 往前推。
- 缺哈希：沿用现有 backfill；补上后与 incoming 相同则 duplicate。
- 同路径换内容：路径不变，仍走 overwrite + `save_book_metadata` 恢复事务。

## Rollback

还原 `import_bytes` 里多出来的同书哈希判断。分类是纯函数式早返回，没有迁移。
