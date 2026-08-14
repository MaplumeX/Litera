# Same-path unchanged reimport should not ask to overwrite

## Goal

从同一磁盘路径再次打开或导入一本**内容未变**的书时，Litera 直接使用书库里已有的那条记录，不再弹出覆盖确认。

## User Value

用户关掉应用再双击同一本 `.epub`，或再次拖入/选择同一文件，应立刻继续读，而不是面对「覆盖这本书？」这种像在替换文件的对话框。

## Background / Confirmed Facts

- 导入分类在 `LibraryStore::import_bytes`（`src-tauri/src/library.rs:353`）。`bookId` 是源路径的 `DefaultHasher`，不是内容哈希。
- 现行三类结果：
  - `duplicate`：另一本书（`book.id != book_id`）已有相同 `contentHash`。不暂存。前端提示「已在书库」并把它算作成功。
  - `overwrite`：该路径对应的 `bookId` 已存在。**不论内容是否变化**都暂存并要求确认。
  - `new`：路径与内容都未命中。
- 去重条件故意排除自己这条记录：`book.id != book_id && content_hash == incoming`（`library.rs:373-375`）。因此「同路径 + 同内容」永远落成 `overwrite`。
- 现有测试 `same_path_reimport_is_overwrite_and_keeps_progress` 用的是 **换了内容** 的 bytes（`version-one` → `version-two`），没有「同路径、内容未变」用例。
- 文件关联冷/热启动都把路径送进 `import_paths`（`08-13-epub-file-association` AC5/AC6）：内容已在书库应直接打开；同路径**且内容变了**才确认覆盖。实现漏了「同路径 + 内容未变」。
- 分类前会 `backfill_missing_content_hashes`（`library.rs:369`），缺哈希的旧记录会先按已入库 EPUB 补上再比较。
- 从书库点封面打开走 `get_book_open_context` + `open_book_bytes`，不经过导入，不会弹覆盖。

## Requirements

- **R1** 同一源路径再次导入，且传入 EPUB 的 SHA-256 与该书已提交的 `contentHash` 相同：返回 `duplicate`，不暂存、不写 `library.json`、不改进度/设置/会话、不弹覆盖框。
- **R2** 同一源路径再次导入，但哈希不同：仍为 `overwrite`。确认后提交并保留进度/设置/会话；取消则丢弃暂存、书库不变。
- **R3** 不同路径、相同内容：仍为 `duplicate`（现有行为）。
- **R4** 新路径、新内容：仍为 `new`。
- **R5** 所有导入入口共用同一分类：文件选择器、拖放、系统打开（argv / `Opened` / 单实例转发）。系统打开一批处理完后，仍打开最后一本成功的书（`duplicate` 算成功）。
- **R6** 不新增 `ImportStatus`。同路径未变走现有 `duplicate` 前端路径（「已在书库」提示；系统打开则再打开该书）。

## Acceptance Criteria

- [ ] AC1. 书已入库后，用**同一路径、同一字节**再走 `import_bytes` / `import_paths`：结果为 `duplicate`，`importId` 为空，书库记录与磁盘上的 `book.epub` / 封面不变（R1、R3 的对照）。
- [ ] AC2. 同一路径、**不同字节**再导入：结果为 `overwrite`，确认后打开新版本并保留 `lastFraction` / `settings` / `lastOpenedAt` / 会话；取消后该书与当前阅读不变（R2）。
- [ ] AC3. 不同路径、相同字节：仍为 `duplicate`，不新建目录（R3）。
- [ ] AC4. 系统打开一本已入库且未改动的 `.epub`：不出现覆盖对话框，阅读器打开该书（R5、R6）。
- [ ] AC5. 缺 `contentHash` 的旧记录：分类前补哈希后，同路径未变仍走 `duplicate`，不会误报覆盖（R1 + 现有 backfill）。
- [ ] AC6. Rust 单测覆盖「同路径同内容 = duplicate、不暂存」；现有「同路径换内容 = overwrite」与「异路径同内容 = duplicate」测试仍通过。

## Out of Scope

- 改 `bookId` 生成方式，或改用内容哈希当主键。
- 新增第四种导入状态，或为系统打开单独做一套导入。
- 启动时自动恢复上次阅读的书（与本次分类无关）。
- 去掉 `duplicate` 的「已在书库」提示。
- 比较文件 mtime / 大小而不算 SHA-256。
- 非 EPUB、符号链接、不可读文件的既有拒绝规则。

## Decisions

- 同路径且内容未变 = `duplicate`，不是新状态，也不是静默的 `new`。
- 同路径且内容变了 = 继续 `overwrite` + 确认。这是文件关联任务已定的合同，本次不改。
- 修复点在 `import_bytes` 一处分类，三个入口自动生效。

## Technical Notes

- 在「`existed` → 一律 overwrite」之前，若该书已有（或刚 backfill 的）`contentHash` 且等于 `incoming_hash`，按 `duplicate` 返回并跳过 `.imports` 暂存。
- 合同原文在 `.trellis/spec/backend/tauri-commands.md`「Import classification」和 `database-guidelines.md`「Re-import is not a no-op」；实现通过后必须改成「同路径未变是 no-op」。
