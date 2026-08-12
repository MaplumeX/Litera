# Implementation Plan

## Dependency

本子任务无其他新子任务依赖，必须最先实施。它输出稳定的 `LibraryStore` API，供 Raw IPC 子任务复用。

## Checklist

- [ ] 1. 新增可测试的 error/library 模块，把书库 DTO、路径根和命令从 `lib.rs` 提取出来。
- [ ] 2. 增加 `schemaVersion`、启动 reset/backup 流程与失败保护；用临时 app-data 根写单元测试。
- [ ] 3. 实现 `LibraryStore` 串行事务和严格读取，移除所有 `read_library(...).unwrap_or(empty)`。
- [ ] 4. 使用同目录临时文件、flush/sync 和原子 persist 实现书库写入。
- [ ] 5. 实现 `bookId`/设置验证、受控路径派生和先查记录后写文件。
- [ ] 6. 重写导入为单次读取、同 bytes 原子保存；实现同路径重新导入的原地一致更新。
- [ ] 7. 实现删除 staging/rollback/trash 清理，未知 ID 不触碰文件系统。
- [ ] 8. 把 `list_books`、`save_book_metadata`、`update_reading_state` 等文件命令改为 async + blocking worker，保持 UI 错误可见。
- [ ] 9. 重构前端 debounce helper，支持 flush/cancel；在返回书库、切书和窗口关闭路径接入。
- [ ] 10. 增加 Rust 并发/损坏/路径/回滚/导入测试和前端 debounce 生命周期测试。
- [ ] 11. 运行子任务检查，确认没有扩大 asset protocol/CSP 范围。

## Tests

- legacy artifacts 成功移动到 timestamp backup；rename/write 失败不创建新库。
- 两个并发 partial update 最终同时保留 fraction/settings。
- update/delete 不复活记录，删除回滚恢复目录。
- JSON 截断、字段错误、schema 不匹配均不会被空值覆盖。
- `/tmp/x`、`../x`、`a/b`、Windows 风格分隔符、空/未知 ID 全部拒绝。
- 重复导入修改内容后存储 bytes 与返回 bytes 完全相同。
- debounce 在 flush/cancel/unmount/close 路径只执行预期次数。

## Validation Commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml library
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
npm test -- --run
npm run build
```

## Risky Files and Rollback

- `src-tauri/src/lib.rs`、新 library/error 模块、`src/App.tsx`、依赖清单。
- 在切换命令注册前确保新 store 测试通过；若 reset 测试失败，不允许运行真实 app-data 路径。
- 本子任务完成后建立 RP1 提交，后续子任务只通过公开 Library API 访问存储。
