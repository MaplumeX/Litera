# Implementation Plan: Associate Litera as an EPUB opener

## Ordered Checklist

1. **打包声明**
   - [ ] `src-tauri/tauri.conf.json` 增加 `bundle.fileAssociations`（ext/mime/name/description/role/rank）。
   - [ ] 不添加 `exportedType`。

2. **Rust 路径队列**
   - [ ] 新增 `src-tauri/src/open_paths.rs`：解析 URL/argv、入队、drain、`take_pending_open_paths`、`open-paths-available` emit。
   - [ ] `lib.rs` 注册模块与 command。
   - [ ] 单元测试：`file://`、相对路径 + cwd、过滤 flag / 非 epub / argv[0]、take 会清空、重复 take 为空。

3. **单实例 + 生命周期**
   - [ ] 加入 `tauri-plugin-single-instance`（desktop target）。
   - [ ] 该 plugin **最先**注册；回调解析 args、入队、emit、聚焦 `main`。
   - [ ] `setup` 消费本进程 argv。
   - [ ] `build().run` 在 macOS 处理 `RunEvent::Opened`。
   - [ ] 确认现有 `on_window_event` sidecar shutdown 仍然挂上。

4. **前端导入复用**
   - [ ] 把 `LibraryView` 的 `commitStagedImport` / `processImportResults` / 覆盖确认抽到可复用模块（`src/lib` + hook，或由 `App` 持有 confirm）。
   - [ ] `LibraryView` 选择器 / 拖放继续「只导入不打开」。
   - [ ] `App` 在挂载时 listen + take；一批处理完后 `handleOpenBook(lastSuccessfulBookId)`。
   - [ ] listen 使用 disposed flag，避免 StrictMode / 卸载泄漏。
   - [ ] 阅读器页也能弹出覆盖确认。

5. **测试**
   - [ ] 扩展或下移 `LibraryView.test.tsx` 里的导入 / 覆盖 / 多文件用例到抽取后的模块。
   - [ ] 新增 App 或 hook 测试：冷启动 take 打开最后成功的书；覆盖取消不打开该书且继续后续文件；非 epub 报错不入库。
   - [ ] Rust `open_paths` 单测覆盖路径解析与 drain。

6. **验证**
   - [ ] `npm test`、相关 frontend 测试、`cargo test`（`src-tauri`）。
   - [ ] macOS：打包或 `open -a` 验证冷启动 + 热启动（能做再做；开发期至少 argv / take 通路可测）。
   - [ ] Windows / Linux：自动化覆盖 argv + 单实例回调解析；手动清单写在下面。

## Validation Commands

```bash
npm test
cd src-tauri && cargo test
npx tsc --noEmit
```

macOS 手动（打包后）：

```bash
open -a Litera -- /path/to/new.epub
# 应用已运行时再执行一次，应聚焦原窗口并打开
```

## Risky files / rollback points

| 文件 | 风险 |
|---|---|
| `src-tauri/src/lib.rs` | 改 `run()` 生命周期；弄坏 sidecar shutdown 或 command 注册 |
| `src-tauri/tauri.conf.json` | 错误的 fileAssociations 导致打包失败 |
| `src/App.tsx` | 根状态与打开串行；和现有 `openBookController` 竞态 |
| `src/components/LibraryView.tsx` | 抽取导入逻辑时回归拖放 / 覆盖 |

回滚：还原上述文件，去掉 single-instance 依赖。已安装包上的 OS 关联需重装清理。

## Follow-up before `task.py start`

- [x] `prd.md` 已收敛，无未决 Open Questions
- [x] `design.md` / `implement.md` 已写
- [x] `implement.jsonl` / `check.jsonl` 有真实 spec/research 条目
- [ ] 用户批准本规划摘要后才能 `task.py start`
