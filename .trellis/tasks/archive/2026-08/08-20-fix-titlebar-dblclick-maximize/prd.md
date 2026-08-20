# PRD: 修复顶栏双击最大化竞态

## Goal

双击书库或阅读页顶栏的可拖空白处，必须稳定地最大化或还原主窗口。单击拖动仍能移动窗口。用户不再需要“完全不动鼠标再连点两次”才能改窗口大小。

## Background

Windows / Linux 主窗口是无系统标题栏的自定义壳（`src-tauri/src/lib.rs` 97–100 行 `set_decorations(false)`）。可拖区域是书库和阅读页顶栏里的标题文字和中间 flex spacer（`LibraryView.tsx` 188–199 行、`App.tsx` 875–886 行）。

当前协议（`WindowControls.tsx` 16–20 行）：

- 同一节点同时有 `data-tauri-drag-region` 和 `onTitlebarDragMouseDown`
- 第一次 `mousedown` 由属性启动原生拖窗口
- 仅当第二次 `mousedown` 满足 `buttons === 1 && detail === 2` 时才 `toggleMaximize()`

第一次按下已经开始拖窗口。两次点击之间指针只要挪几个像素，浏览器就不会再发 `detail === 2`，最大化静默失败。即便第二次按下成功调用了 `toggleMaximize()`，原生拖动可能仍在进行，窗口会闪一下、状态变了但几何不变，或马上被拖回去。

`preventDefault()` 发生在第二次按下，拦不了第一次已经开始的原生拖动；拖动也不是 DOM 默认行为。单元测试只覆盖了“已经拿到 `detail === 2`”的路径（`WindowControls.test.tsx` 91–111 行），测不到这次竞态。

Tauri 同类问题：`data-tauri-drag-region` 双击还原最大化时状态变成未最大化、尺寸位置仍停在全屏（[tauri#11945](https://github.com/tauri-apps/tauri/issues/11945)）；无装饰窗口上双击该属性本身也不稳定（[wry#622](https://github.com/tauri-apps/wry/issues/622)）。

`src-tauri/capabilities/default.json` 已有 `core:window:allow-start-dragging`。右侧最大化按钮走独立 `toggleMaximize()`，不受影响。

## Requirements

- R1. 在标题或 spacer 上用主键双击，必须调用 `toggleMaximize()`。第一次按下不得启动窗口拖动。
- R2. 在标题或 spacer 上主键按下后移动超过一小段阈值，必须调用一次 `startDragging()`，窗口随指针移动。从最大化状态拖出时，仍由 Tauri 原生行为负责还原再移动。
- R3. 同一次手势里如果已经 `toggleMaximize()`，不得再 `startDragging()`。
- R4. 主键单击且未过移动阈值：不最大化、不开始拖。
- R5. 可拖命中范围仍只有标题和 spacer。搜索框、工具按钮、窗口按钮保持可点、不可拖。不另加一条标题栏。
- R6. 平台壳不变：macOS Overlay + 红绿灯；Windows / Linux 自定义最小化 / 最大化 / 关闭。自定义关闭仍走 `close()`，不走 `destroy()`。
- R7. 现有窗口几何记忆、阅读进度关闭刷盘、面板/TOC 拖动手柄都不改。

## Acceptance Criteria

- [ ] AC1. 双击标题或 spacer（主键）会 `toggleMaximize()`；第一次按下不会 `startDragging()`。（R1）
- [ ] AC2. 主键按下后指针移动超过约定阈值，调用一次 `startDragging()`；未过阈值不调用。（R2、R4）
- [ ] AC3. 同一次手势已触发最大化时，后续 move 不再 `startDragging()`。（R3）
- [ ] AC4. 书库和阅读页顶栏只有标题和 spacer 是拖动手势目标；搜索和所有按钮都不是。（R5）
- [ ] AC5. macOS 仍无自定义窗口按钮；Windows / Linux 三个窗口按钮行为不变；关闭仍是 `close()`。（R6）
- [ ] AC6. `WindowControls` / 书库 / 阅读页相关测试覆盖双击、阈值拖动、单击不拖；`npm test` 与 `npm run build` 通过。（R1–R6）
- [ ] AC7. 手动：`npm run tauri dev` 下连点顶栏空白能稳定最大/还原；按住拖动能移动窗口；按钮和搜索仍可点。（R1、R2、R5、R7）

## Out of Scope

- 窗口最外圈拉伸边的双击贴边/拉高（Windows Aero 边框双击）。
- Windows 11 Snap Layout 预览。
- 最大化按钮在还原态切换图标。
- 改 `decorations` / Overlay / 红绿灯位置。
- 对话栏、书籍栏、TOC 抽屉的分隔条双击。
- 改 `tauri-plugin-window-state` 或 `preferences.json`。

## Key Decisions

- 可拖节点不再使用 `data-tauri-drag-region`。拖动改为指针移动过阈值后调用 `startDragging()`。
- 双击仍以主键 + `detail >= 2` 判定，但发生在尚未开始拖的手势上。
- 命中范围、平台壳、关闭路径保持 `08-14-remove-native-shell` 的产品约定。
