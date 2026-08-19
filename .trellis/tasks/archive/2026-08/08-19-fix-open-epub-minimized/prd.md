# PRD: 最小化时点击 epub 不恢复前台

## 背景

应用已在运行但窗口最小化时，点击系统里关联的 epub 文件，书籍会被导入并打开（前端逻辑正常），但窗口不会恢复到前台，用户看不到任何反应。

## 根因

`src-tauri/src/open_paths.rs` 的 `handle_second_instance` 只调用了 `window.set_focus()`。查证 tao 0.35.3 源码，三个平台对**最小化**窗口的 `set_focus` 都是 no-op：

- macOS `platform_impl/macos/window.rs:677`：`if !is_minimized && is_visible { set_focus(...) }`
- Windows `platform_impl/windows/window.rs:175`：`if is_visible && !is_minimized && !is_foreground`
- Linux `platform_impl/linux/window.rs:567`：`if !self.minimized && visible`

## 需求

在 `handle_second_instance` 中，入队路径后按顺序执行：`unminimize()` → `show()` → `set_focus()`，确保最小化（以及隐藏）状态下窗口能恢复并置前。

## 验收标准

1. `handle_second_instance` 在 `set_focus` 前调用 `unminimize` 和 `show`。
2. 三个 API 在窗口状态不匹配时均为安全 no-op，不引入新错误路径。
3. `cargo test`（open_paths 模块）通过。
4. 手动验证：应用最小化时点击 epub，窗口恢复前台并打开书籍。
