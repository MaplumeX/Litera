# Publish Litera 0.2.6

## Goal

把 Litera 从 `0.2.5` 发成 `0.2.6`：版本号 lockstep、changelog、tag、三平台 draft Release，维护者确认安装包后 Publish。

## User Value

0.2.5 之后的用户可见改动（覆盖字体/排版、多色高亮与笔记、阅读器布局记忆、对话目录、夜间对比、思考强度档位、Windows 顶栏双击）进入可下载安装包。

## Confirmed Facts

- 当前版本 `0.2.5`，写在 `package.json`、root `package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`。
- 最新 tag 是 `v0.2.5`（`38c42d0`）。`main` 与 `origin/main` 同步。
- 发版流程：`README.md`「维护者发版」和 `.trellis/spec/backend/release.md`。
- 用户于 2026-08-23 确认按下列 changelog 发版，轻量任务 PRD-only。
- 版本号 bump：`npm run version:bump -- 0.2.6`。
- Tag `v0.2.6` 推送后触发 `.github/workflows/release.yml`；产物进 draft GitHub Release。Publish 必须在维护者装包确认之后。

## Requirements

- R1. 版本号在 `package.json`、root `package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 均为 `0.2.6`；`node scripts/bump-version.mjs --check` 通过。
- R2. `CHANGELOG.md` 顶部从 `## [Unreleased]` 之后写入 `## [0.2.6] - 2026-08-23` 及下列用户可见变化（口径已确认）：

### Added

- **覆盖字体 / 覆盖排版**：设置 → 排版里两个独立开关，可压过 EPUB 内嵌字体和章节排版，也可只开一项或全关保留原样。
- **多色高亮与笔记**：划线支持固定色板；点正文高亮可改色、写笔记、删除。
- **阅读器布局记忆**：每本书记住聊天栏、书页、会话栏的开合，下次打开同一本时恢复。
- **对话目录**：聊天标题栏可打开用户消息大纲，点击跳到对应提问。

### Changed

- **夜间正文对比**：深色主题正文字色调暗，长时间夜间阅读不那么刺眼。

### Removed

- **思考强度 minimal**：输入栏去掉 `minimal` 档。

### Fixed

- **Windows 顶栏双击最大化**：双击标题栏空白或标题文字会稳定最大化/还原（0.2.5 在 Windows 上完全失效）。

- R3. 提交上述改动后打 `v0.2.6`，推送 `main` 与 tag。
- R4. 等待 Linux / macOS / Windows 三个 job 成功；draft Release 含 AppImage、deb、dmg、NSIS exe。
- R5. 维护者本地装包确认后，再 Publish 该 Release。CI 不得把 Release 直接标成 published。

## Acceptance Criteria

- [ ] AC1. 五处版本号均为 `0.2.6`，`--check` 通过。
- [ ] AC2. `CHANGELOG.md` 有 `0.2.6` 条目，内容与 R2 一致，Keep a Changelog 风格与既有版本一致。
- [ ] AC3. 存在 commit + `v0.2.6` tag，且已推到 `origin`。
- [ ] AC4. GitHub Actions Release workflow 三平台成功；draft 上有 AppImage、deb、dmg、NSIS exe。
- [ ] AC5. Release 在维护者确认前保持 draft。

## Out of Scope

- 应用内自动更新、代码签名 / 公证。
- 改发版 workflow 或 bump 脚本。
- 未列入 R2 的内部修复、journal、spec-only 改动。
- Intel Mac / ARM Windows / Linux ARM。
