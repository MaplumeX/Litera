# Add About section with app version

## Goal

用户打开设置后，能在「关于」里看到当前安装的 Litera 版本号，并能用系统浏览器打开 GitHub 仓库和 Releases。

## Background

应用内没有 About / 版本号界面。`SettingsDialog` 左侧只有排版、外观、AI（`src/components/settings/SettingsDialog.tsx`）。书库齿轮和阅读器设置都进同一个对话框。

版本号已在发布侧 lockstep 为 `0.2.0`：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（`.trellis/spec/backend/release.md`）。前端从未调用 `getVersion` / `getName`。

UI 文案必须走 `zh-CN` / `en` catalogs + `useT()`（`.trellis/spec/frontend/i18n.md`）。应用没有打开外部 URL 的能力：无 opener 插件，CSP `default-src 'self'`，不能用 WebView `<a href>` 跳到 GitHub。

用户可见变更仍只写在仓库 `CHANGELOG.md` 和 GitHub Releases，不进应用内。

## Requirements

- **R1** 设置左侧导航在现有三项之后增加「关于」。书库和阅读器共用这个入口，不再单独做按钮或窗口。
- **R2** 「关于」显示应用名 `Litera`（专有名词，不翻译）和当前运行时版本号。版本来自 `@tauri-apps/api/app` 的 `getVersion()`，不手写死在组件里。
- **R3** 「关于」提供两个操作：打开 GitHub 仓库 `https://github.com/MaplumeX/Litera`，打开 Releases `https://github.com/MaplumeX/Litera/releases`。
- **R4** 点击链接用系统默认浏览器打开。失败时不关闭设置、不崩溃；记录错误即可。
- **R5** 新增文案中英对照，key 集合保持两边一致。
- **R6** 切到「关于」时，不再显示排版 scope 文案（「正在编辑默认排版」/「正在编辑《…》的排版」）。改用关于自己的简短说明。
- **R7** `getVersion` 失败时版本处显示占位（如 `—`），链接仍可用。

## Acceptance Criteria

- [ ] **AC1**（R1）设置打开后，左侧能看到并点选「关于」；点选后右侧只显示关于内容，不再显示排版滑杆、外观控件或 AI 表单。
- [ ] **AC2**（R2, R7）关于页显示 `Litera` 和 `getVersion()` 返回的版本；mock 为 `0.2.0` 时用户能看到 `0.2.0`；`getVersion` reject 时显示占位且页面仍可用。
- [ ] **AC3**（R3, R4）点「源码仓库」调用 opener 打开仓库 URL；点「发行版本」打开 Releases URL。测试 mock `openUrl`，不断言真实浏览器。
- [ ] **AC4**（R5）`zh-CN` 导航为「关于」，`en` 为 `About`。至少有一条测试切到 `en` 后断言 `About`。
- [ ] **AC5**（R6）关于分区不出现 `settings.editingDefault` / `settings.editingBook` 文案。
- [ ] **AC6** 现有设置行为不变：默认仍打开排版；外观 / AI 切换、书籍排版 scope、恢复默认仍通过现有测试。

## Out of Scope

- 应用内检查更新、自动更新
- 应用内展示 CHANGELOG 全文
- 许可证全文、系统信息、Tauri / OS 版本
- 独立 About 窗口、路由、书库或标题栏新按钮
- 复制版本号、应用图标、产品介绍长文

## Technical Notes

- 版本读取用已有 `@tauri-apps/api/app`，不新增 command。
- 外链用 `tauri-plugin-opener` 的 `openUrl`。手动加 crate 和 npm 包，不要跑 `npm run tauri add opener`（会授予 `opener:default`，范围过大）。
- capability 只授 `opener:allow-open-url`，且只允许上述两个 GitHub URL。不授 `open-path` / `reveal-item-in-dir`。
- 插件在 `src-tauri/src/lib.rs` 与 dialog / http 一起 `builder.plugin(...)` 注册；权限写在 `src-tauri/capabilities/default.json`。
- 链接做成 button，不要用 `<a href>`。
- 不改 `preferences.json`，不加新 Tauri command。
