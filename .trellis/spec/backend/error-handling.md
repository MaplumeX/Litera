# Error Handling

> How errors are handled in this project.

---

## Overview

<!--
Document your project's error handling conventions here.

Questions to answer:
- What error types do you define?
- How are errors propagated?
- How are errors logged?
- How are errors returned to clients?
-->

(To be filled by the team)

---

## Error Types

<!-- Custom error classes/types -->

(To be filled by the team)

---

## Error Handling Patterns

<!-- Try-catch patterns, error propagation -->

(To be filled by the team)

---

## API Error Responses

<!-- Standard error response format -->

(To be filled by the team)

---

## Common Mistakes

<!-- Error handling mistakes your team has made -->

### Tauri 命令主线程死锁：同步命令中调用阻塞式对话框

**症状**：前端调用 `invoke("open_file")` 后应用完全冻结，系统文件对话框不出现，只能强制退出。

**根因**：Tauri v2 中，非 `async` 的 `#[tauri::command]` 在主线程同步执行。`tauri_plugin_dialog` 的 `blocking_pick_file()` 需要把对话框显示工作派发到主线程并阻塞等待结果；此时主线程已被该命令占用，形成死锁——对话框永远等不到主线程来显示，命令也永远等不到对话框返回。

**修复**：把命令改为 `async fn`，让它运行在 Tauri 异步 runtime 上（不占用主线程），阻塞式 API（`blocking_pick_file()`、`std::fs::read`）用 `tauri::async_runtime::spawn_blocking` 包裹在专用线程池执行。`AppHandle` 需要 `clone()` 后 `move` 进闭包，外层 `app` 仍可用于后续 state 访问。

**规则**：Tauri v2 命令凡需调用 `blocking_*` 对话框 API 或同步阻塞 I/O，必须定义为 `async fn` 并用 `spawn_blocking` 承载阻塞部分。参考 `src-tauri/src/lib.rs` 中 `open_file`。
