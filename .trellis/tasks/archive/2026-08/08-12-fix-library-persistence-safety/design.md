# Technical Design

## Ownership and Module Boundary

将书库逻辑从 `src-tauri/src/lib.rs` 提取到可单测模块，建议结构：

```text
src-tauri/src/
├── lib.rs              # Tauri builder 与命令注册
├── error.rs            # 可序列化 AppError/AppErrorCode
└── library.rs          # LibraryStore、存储事务、路径验证、library commands
```

`LibraryStore` 由 Tauri `manage()` 注入，内部持有异步互斥门和 app-data 根路径。所有读改写命令改为 `async fn`；阻塞文件操作在持有逻辑事务顺序的前提下通过 `spawn_blocking` 执行。

## Storage Format

新格式在顶层增加固定版本：

```json
{
  "schemaVersion": 1,
  "books": []
}
```

旧格式不迁移。初始化在 sidecar 启动前将旧 `library.json`、`books/`、`sessions/` 移动到 `backup/legacy-<timestamp>/`，然后创建空的 v1 存储。

## Transaction Model

### Read-only

`list_books`、读取打开上下文和读取 EPUB 都经过同一 store gate，确保不会观察到删除/导入的中间状态。文件字节读取完成后再释放事务；大文件响应转换由后续 IPC 子任务完成。

### Read-modify-write

`save_book_metadata`、`update_reading_state`、导入记录和删除元数据遵循：

1. 获取 store gate。
2. 从磁盘读取并严格解析当前 v1 数据。
3. 验证参数与记录。
4. 在内存中修改。
5. 使用同目录 `tempfile::NamedTempFile` 写入、flush、`sync_all`，再 `persist()` 原子替换。
6. 需要时同步父目录；成功后释放 gate。

任何读取/解析错误都直接返回，不产生空 fallback。

### Delete recovery

删除先把 `books/<id>` 原子重命名到受控 `.trash/<operation-id>`，再提交书库元数据：

- 元数据写入失败：把目录 rename 回原位置。
- 元数据成功：异步递归删除 trash；删除失败保留 trash 并在下次启动清理，不复活记录。
- 不存在的 ID 在任何文件操作前返回 `BookNotFound`。

## Path Safety

- `bookId` 只接受明确格式，拒绝空值、分隔符、`.`、`..`、绝对路径和非 ASCII 安全字符。
- 即使 ID 通过格式验证，文件目标仍只通过 `books_root.join(validated_id)` 派生。
- 删除前检查目标的直接父目录就是受信任的 `books_root`；不使用前端路径，也不使用持久化记录中的路径作为删除根。
- 严格读取要求持久化的 `filePath`/`coverPath` 等于受控派生路径，并拒绝 books、book、trash、imports、transactions 目录中的符号链接。
- `save_book_metadata` 先查记录，再计算封面路径。

## Import Consistency

文件选择与读取保留在 `spawn_blocking`。选中的 EPUB 只读取一次，并为这份 bytes 生成 `importId`：

- 捕获的同一份 bytes 写入受控 `.imports/<importId>.epub`，并返回前端。
- 首次导入同时写入自洽的 canonical EPUB 与占位记录；元数据解析失败时不会留下旧内容与新元数据混配。
- 同路径 ID 已存在时，不立即替换 canonical EPUB。前端把 `importId` 连同从这份 bytes 提取的元数据传给 `save_book_metadata`。
- 提交重复导入前，在 `.transactions/<importId>/` 持久化旧 EPUB/封面与 journal；随后切换文件，并以 `library.json` 中随元数据一起原子更新的内部 `contentVersion` 作为提交点。
- 写入或元数据提交失败时恢复旧 EPUB/封面；进程中断后，启动恢复根据 `contentVersion` 判断回滚旧版本或保留已提交新版本。
- 保留该记录的进度和设置。

这样把“同一路径再次导入”定义为带身份绑定的可恢复更新；解析失败、保存失败和进程中断都不会产生旧元数据配新 EPUB。

## Reading State Lifecycle

前端 debounce helper 返回 `{ schedule, flush, cancel, pending }`：

- relocate/settings 继续 500ms debounce。
- 返回书库前 await flush；切书时先 flush 旧 bookId。
- 窗口关闭请求先阻止默认关闭，await flush 后再 destroy；设置超时避免无限阻塞。
- 后端串行事务保证 flush 与 delete 无法互相覆盖；删除先完成时，迟到更新返回 `BookNotFound`，前端显示可关闭的保存失败提示而不是静默吞掉。

## Validation

- `lastFraction` 必须是有限数且位于 `[0,1]`。
- `fontSize` 必须有限并处于 UI 支持范围。
- `fontFamily` 和 `theme` 只接受前端支持值。
- title/author/cover 限制合理大小，避免 IPC 或磁盘滥用。

## Error Contract

使用可序列化的 `{ code, message }` 错误，至少覆盖：`Cancelled`、`InvalidInput`、`BookNotFound`、`StorageCorrupt`、`StorageIo`、`RollbackFailed`。文件选择取消保持前端静默处理，其余错误可见。

## Compatibility and Rollback

- 不迁移旧数据，只创建可恢复备份。
- 如果初始化、备份或新空库写入失败，Tauri 仍可启动 UI，但书库命令返回明确 initialization error，sidecar 不应基于半初始化目录启动。
- 删除 trash 和旧 backup 不自动永久清理，避免本任务引入不可恢复删除策略。
