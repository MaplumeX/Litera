# Publish Litera 0.2.8

## Goal

把 Litera 从 `0.2.7` 发成 `0.2.8`：版本号 lockstep、changelog、tag、三平台 draft Release，CI 成功并填好 notes 后 Publish。

## User Value

0.2.7 之后的用户可见改动（书籍详情字段、继续阅读封面尺寸、对话刻度轨）进入可下载安装包。

## Confirmed Facts

- 当前版本 `0.2.7`，写在 `package.json`、root `package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 最新 tag 是 `v0.2.7`（`bebb9a0`）。`main` 与 `origin/main` 同步。
- 发版流程：`.trellis/spec/backend/release.md`。`npm run version:bump -- 0.2.8` 更新版本文件；`node scripts/bump-version.mjs --check` 校验。
- Tag `v0.2.8` 推送后触发 `.github/workflows/release.yml`；产物进 draft GitHub Release。CI 不得把 Release 直接标成 published。
- 用户于 2026-08-26 确认按下列 changelog 发 0.2.8，轻量任务 PRD-only，并回复「直接做」。

## Requirements

- R1. 版本号在 `package.json`、root `package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 均为 `0.2.8`；`node scripts/bump-version.mjs --check` 通过。
- R2. `CHANGELOG.md` 顶部从 `## [Unreleased]` 之后写入 `## [0.2.8] - 2026-08-26` 及下列用户可见变化（口径已确认）：

### Added

- **书籍详情字段**：详情可改简介、出版社、语言、系列；新导入从 EPUB 预填；保存只写书架记录，不改 EPUB。打开详情不再全选书名。

### Fixed

- **继续阅读封面**：顶部继续阅读卡片与下方书架网格同尺寸，不再被拉成整列那么宽。
- **对话刻度轨**：工作区刻度挤在中间、条目分开；轨出现时消息列左缘让位，助手气泡不再被挡住。

- R3. 提交上述改动后打 `v0.2.8`，推送 `main` 与 tag。
- R4. 等待 Linux / macOS / Windows 三个 job 成功；draft Release 含 AppImage、deb、dmg、NSIS exe。
- R5. 用与 `v0.2.7` 同结构的英文 notes 填 draft（changelog 译文 + Downloads + 未商业签名提示），再 Publish。

## Acceptance Criteria

- [ ] AC1. 五处版本号均为 `0.2.8`，`--check` 通过。
- [ ] AC2. `CHANGELOG.md` 有 `0.2.8` 条目，内容与 R2 一致，Keep a Changelog 风格与既有版本一致。
- [ ] AC3. 存在 commit + `v0.2.8` tag，且已推到 `origin`。
- [ ] AC4. GitHub Actions Release workflow 三平台成功；draft 上有 AppImage、deb、dmg、NSIS exe。
- [ ] AC5. GitHub Release notes 为英文、结构对齐 `v0.2.7`；维护者确认前保持 draft，确认后 Publish。

## Out of Scope

- 应用内自动更新、代码签名 / 公证。
- 改发版 workflow 或 bump 脚本。
- README 双语改写、截图、journal、spec-only 改动。
- Intel Mac / ARM Windows / Linux ARM。
