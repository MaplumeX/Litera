# Litera

带阅读助手的跨平台 EPUB 阅读器。在书页旁边和助手对话：选中一段提问，或让它自己去读目录、章节和全文检索。

Linux x64、macOS Apple Silicon、Windows x64。安装包未做付费代码签名。

## 下载

- 所有版本：<https://github.com/MaplumeX/Litera/releases>
- 最新正式版（draft 发布之后）：<https://github.com/MaplumeX/Litera/releases/latest>

| 平台 | 安装包 |
| --- | --- |
| Linux x64 | `.AppImage` 或 `.deb` |
| macOS Apple Silicon | `.dmg` |
| Windows x64 | NSIS `.exe` |

各版本的用户可见变化见 [CHANGELOG.md](./CHANGELOG.md)。

## 安装

### Linux

- **AppImage**：`chmod +x Litera_*.AppImage`，然后双击或在终端运行。
- **deb**：`sudo dpkg -i litera_*.deb`（或用软件中心打开）。

### macOS（Apple Silicon）

打开 `.dmg`，把 Litera 拖到「应用程序」。第一次从网上下载的未签名应用：

1. 不要只双击。在 Finder 里 **右键 → 打开**，再确认打开。
2. 若系统仍拦截：打开 **系统设置 → 隐私与安全性**，在被拦下的 Litera 旁点 **仍要打开**。

构建使用 ad-hoc 签名（`signingIdentity: "-"`），避免 Apple Silicon 把从 GitHub 下载的应用标成「已损坏」。这 **不能** 跳过「未识别的开发者」提示。

### Windows

运行 NSIS 安装程序。SmartScreen 可能提示「Windows 已保护你的电脑」：点 **更多信息 → 仍要运行**。

## 维护者发版

版本号必须在这四处一致，tag 去掉 `v` 后等于应用版本（`v0.1.0` ↔ `0.1.0`）：

- `package.json`
- `sidecar/package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

1. 改版本（第一版已是 `0.1.0`，不必再 bump）：

   ```bash
   npm run version:bump -- x.y.z
   ```

2. 在 `CHANGELOG.md` 顶部写 `## [x.y.z] - YYYY-MM-DD` 及用户可见变化。
3. 提交这些改动。
4. 打 tag 并推送（会触发 [Release workflow](.github/workflows/release.yml)）：

   ```bash
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

5. 在 Actions 里等三个平台 job 跑完（`fail-fast: false`，单个平台失败不会把其余取消，也不会把 Release 标成 published）。
6. 打开 draft Release，确认有 AppImage、deb、dmg、NSIS exe。
7. 本地装一下后，再在 GitHub 上 **Publish**。

重跑失败的 tag 构建：在对应 Actions run 上 Re-run，或对同一 commit 使用 `workflow_dispatch`（会挂到当前版本对应的 `v*` Release 上）。不要让 tauri-action 另造 `app-v__VERSION__` tag。

本地开发：克隆时带上 submodule（`git clone --recurse-submodules`，或已有仓库里 `git submodule update --init`），然后 `npm install` 和 `npm run tauri dev`。`predev` / `prebuild` 会在本机编 sidecar，不要把 `src-tauri/binaries/` 提交进仓库。`src/foliate-js` 不在主仓库树里，漏掉 submodule 时 `vite build` 会找不到 `view.js`。
