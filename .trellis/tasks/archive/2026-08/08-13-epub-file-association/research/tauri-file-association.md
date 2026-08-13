# Research: Tauri 2 file association + single instance

## fileAssociations

Source: https://v2.tauri.app/reference/config/ and https://v2.tauri.app/learn/mobile-file-associations/

`bundle.fileAssociations[]`:

| Field | Use for Litera |
|---|---|
| `ext` | `["epub"]`（不要带点） |
| `mimeType` | `application/epub+zip`（Linux `.desktop` 的 `MimeType=`；Android intent 也用） |
| `name` | `EPUB`（macOS `CFBundleTypeName`） |
| `role` | `Viewer`（默认是 `Editor`；Litera 不改原文件） |
| `rank` | `Default`（不是 `Owner`；Owner 用于应用私有类型） |
| `description` | Windows 资源管理器 Type 列，例如 `EPUB Book` |
| `contentTypes` | 可选：`org.idpf.epub-container`（macOS 系统 EPUB UTI） |
| `exportedType` | **不要设**。EPUB 是公共格式 |

安装器根据该配置写 Info.plist / .desktop / Windows 文件关联。`tauri dev` 通常不会向系统注册关联；本机验证要用打包后的应用，或开发期用 argv / `open -a`。

## RunEvent::Opened

Source: https://v2.tauri.app/learn/mobile-file-associations/

只在 **macOS / iOS / Android** 上发出，payload 是 `urls: Vec<tauri::Url>`（通常是 `file://`）。

官方模式：

1. 冷启动：事件发生在前端挂载前 → 存进 managed state，前端 `invoke` 再取。
2. 热启动：同一进程再收到 Open → `app.emit(...)` 给已挂载的前端。

官方示例的 `opened_urls` 是 clone 不是 drain，组件重挂会重复处理。Litera 应 **drain 队列**，并用「先 listen 信号、再 take」避免丢失。

把 `Builder::run` 改成 `Builder::build(...).run(|app, event| { ... })` 才能截获 `RunEvent::Opened`。

## Windows / Linux 打开文件

双击会再拉起一个进程，路径在 `std::env::args()` 里（argv[0] 是可执行文件）。没有 `RunEvent::Opened`。

已运行时必须靠 `tauri-plugin-single-instance`：第二个进程把 `args` + `cwd` 交给第一个进程后退出。相对路径要用第二个进程的 `cwd` 拼成绝对路径。

## Single instance

Source: https://v2.tauri.app/plugin/single-instance/

- 必须是 **第一个** 注册的 plugin。
- `init(|app, args, cwd| { ... })` 在第二个实例被拦下时调用。
- 默认不聚焦窗口，回调里要自己 `get_webview_window("main")?.set_focus()`。
- 无 JS API，不必改 capabilities。
- Linux 用 DBus 服务 `org.{id}.SingleInstance`（identifier 里的 `.` / `-` 换成 `_`）。Snap / Flatpak 要额外清单，本次不做。

安装：`cargo add tauri-plugin-single-instance --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`，或 `npm run tauri add single-instance`。

## Frontend listen 约定

项目里已有模式：`use-agent-bridge.ts` 先注册 listener，用 disposed flag 防止 cleanup 后才 resolve 的 `listen()` 泄漏。系统打开信号应复用同一套 lifecycle，不要再开一条长期 payload 队列在 JS 里。
