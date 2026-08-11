# PRD: 修复导入文件卡死 (open_file 主线程死锁)

## 问题

点击"打开文件"按钮触发 `open_file` Tauri 命令时，应用卡死：文件对话框不出现，UI 完全冻结，只能强制退出。

## 根因

`src-tauri/src/lib.rs:319` 的 `open_file` 命令定义为**同步**函数：

```rust
#[tauri::command]
fn open_file(app: tauri::AppHandle) -> Result<OpenFileResult, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("EPUB", &["epub"])
        .blocking_pick_file()  // ← 阻塞主线程
        ...
```

在 Tauri v2 中，非 `async` 的 `#[tauri::command]` 在主线程同步执行。
`blocking_pick_file()` 需要把对话框显示工作派发到主线程并阻塞等待结果，
但此时主线程已被该命令占用 → 死锁：对话框永远等不到主线程来显示，命令也永远等不到对话框返回。

## 目标

修复死锁，使"打开文件"按钮能正常弹出系统文件选择对话框、读取 EPUB、返回给前端渲染。

## 范围

- 仅修改 `src-tauri/src/lib.rs` 中的 `open_file` 命令。
- 前端调用方式不变（`invoke("open_file")` 接口签名保持一致）。
- 不改动 sidecar 通知、bookId 计算、sessions 相关逻辑的语义。

## 方案

将 `open_file` 改为 `async fn`，使其运行在 Tauri 异步 runtime 上（不阻塞主线程）。
对话框与文件读取部分用 `tauri::async_runtime::spawn_blocking` 包裹（它们是同步阻塞 API）。
后续的 sidecar 通知、`OpenFileResult` 构造可在 async 上下文中正常进行。

## 验收标准

1. `cargo build` (或 `cargo check`) 通过，无新警告（除原有者外）。
2. 运行应用，点击"打开文件"按钮，系统文件选择对话框正常出现，UI 不冻结。
3. 选择一个 `.epub` 文件后，书籍正常加载到 ReaderView，文件名显示在顶栏。
4. 取消文件对话框（点击取消）时，前端得到 `null`，UI 不崩溃、不卡死。
5. 连续多次点击"打开文件"切换不同 EPUB，均能正常加载，无死锁复发。