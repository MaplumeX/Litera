# Three-platform GitHub Release pipeline

## Goal

维护者推一个 `v*` tag 后，GitHub Actions 在 Linux / macOS / Windows 原生环境打出可安装包，并挂到 draft GitHub Release 上。本次任务还要打出第一版 `v0.1.0` draft，确认三平台产物都上传成功。

## Background

Litera 是 Tauri 2 桌面应用，带用 `@yao-pkg/pkg` 打成的自包含 Node sidecar。当前版本已是 `0.1.0`，写在 `package.json`、`sidecar/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`。仓库没有 tag、没有 `.github/workflows`、没有 `CHANGELOG.md`。远端 `https://github.com/MaplumeX/Litera` 是 public；本地 `main` 比 `origin/main` 超前 24 个 commit。

sidecar 禁止交叉编译（`sidecar/scripts/target.mjs`）：请求的 triple 必须等于 `rustc --print host-tuple`。`src-tauri/binaries/` 已 gitignore。`tauri.conf.json` 的 `bundle.targets` 目前是 `"all"`。未配置 updater，也没有付费代码签名。

## Requirements

- R1. 推送匹配 `v*` 的 tag 后，三平台 job 各自原生构建 sidecar + Tauri 安装包。
- R2. 构建成功后，安装包上传到对应该 tag 的 draft GitHub Release。
- R3. 发版前版本号在上述四处保持一致；tag 去掉 `v` 前缀后等于应用版本（`v0.1.0` ↔ `0.1.0`）。
- R4. `CHANGELOG.md` 记录每个已发布版本的用户可见变化。
- R5. README 写清如何改版本、如何打 tag、各平台怎么装，以及未签名 macOS / Windows 的系统提示怎么过。
- R6. 任一平台构建失败不得把 Release 标成 published；其余平台仍应尽量出包（`fail-fast: false`）。
- R7. CI 不得提交或依赖仓库里的预编译 sidecar。
- R8. macOS 构建使用 ad-hoc signing（`signingIdentity: "-"`），避免 Apple Silicon 从 GitHub 下载后被当成损坏。
- R9. 流水线合入后，推送落后的 commit、打 `v0.1.0`、等三平台 CI，确认 draft Release 上有 Linux / macOS / Windows 安装包。

## Acceptance Criteria

- [ ] AC1. 仓库中有由 `v*` tag 触发的 GitHub Actions 发版 workflow，覆盖 Linux x64、macOS Apple Silicon、Windows x64。
- [ ] AC2. 每个平台 job 在 runner 上现场构建 sidecar，不使用仓库里的预编译二进制。
- [ ] AC3. 成功 run 会创建或更新 draft GitHub Release，并附上该平台安装包。
- [ ] AC4. 版本号四处一致；存在 `CHANGELOG.md` 和 README 发版 / 安装说明。
- [ ] AC5. README 写明未签名 macOS、Windows 的安装注意点。
- [ ] AC6. GitHub 上存在 `v0.1.0` draft Release，且能看到三平台安装包。

## Out of scope

- 应用内自动更新（`tauri-plugin-updater`、`latest.json`、签名密钥）。
- Apple Developer 公证、Windows Authenticode。
- Linux ARM、Windows ARM、Intel Mac。
- 商店分发（Homebrew / winget / Flathub / Microsoft Store / App Store）。
- 从 `main` 每次 push 自动发版；semantic-release / 从 conventional commit 生成 changelog。
- PR 上的完整打包 CI。

## Technical Notes

- sidecar 目标由 `TAURI_TARGET_TRIPLE` / `TAURI_ENV_TARGET_TRIPLE` / `CARGO_BUILD_TARGET` / `--target` 选择；非本机 triple 直接失败。
- 官方 tauri-action 用 tag 触发时，应用已有的 tag，不要让 action 再造一个 `app-v__VERSION__` tag。
- macOS ad-hoc 签名不能绕过「未识别开发者」提示，只能避免「已损坏」。
- 第一版版本号保持现有 `0.1.0`，不另做 bump。
