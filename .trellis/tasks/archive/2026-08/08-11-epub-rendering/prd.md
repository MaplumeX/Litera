# EPUB Rendering (foliate.js)

## Goal

集成 foliate.js 到 Tauri 应用，实现打开 EPUB 文件、分页阅读、选段捕获功能。

## Parent Reference

父任务：`08-11-agent-epub-reader`。本子任务对应 `implement.md` Child 2。依赖 Child 1（已完成：Tauri + React 脚手架）。

## Requirements

- 将 `foliate-js` 作为 git submodule 添加到 `src/foliate-js/`（上游推荐方式，API 不稳定需锁定 commit）
- 创建 `ReaderView` React 组件：挂载 `<foliate-view>` 自定义元素
- 实现 `openFile`：Rust command `open_file` → 返回 path + bytes → WebView `new File([bytes])` → `view.open(file)`
- Rust 端 `open_file` command：用 `tauri-plugin-dialog` 弹文件选择器，读 epub 为字节数组返回
- 监听 `relocate` 事件，向上传递当前 chapterIndex / fraction
- 基础阅读 UI：上一页/下一页按钮、章节进度显示
- 选段捕获：监听 selection，弹出"问 agent"按钮，记录选中文本 + chapterIndex
- foliate.js 的 view.js 需要适配 Vite 构建（ES 模块 import 路径）

## Acceptance Criteria

- [ ] `foliate-js` 作为 git submodule 存在于 `src/foliate-js/`
- [ ] 能通过文件按钮/菜单打开 `.epub` 文件并正确渲染
- [ ] 分页浏览正常：上一页/下一页按钮工作
- [ ] 章节进度显示（当前章节 + fraction）
- [ ] 选中文字时浮出"问 agent"按钮
- [ ] 点击"问 agent"按钮后选中文本 + chapterIndex 被记录（可通过 console.log 或回调验证，不要求接 agent）
- [ ] `relocate` 事件正确传递 chapterIndex / fraction
- [ ] `npm run build` 通过

## Out of Scope

- pi agent 集成（Child 3）
- 对话面板（Child 4）
- FTS5 索引（Child 4）
- agent 工具（Child 4）
- 选段文本发送给 agent（Child 4，本子任务只捕获不发送）