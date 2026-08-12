# Implementation Plan

## Dependencies

- 必须在 `08-12-fix-library-persistence-safety` 完成后启动，以复用其 store/read API。
- 本子任务完成的 externalBin/shell transport 是 `08-12-fix-sidecar-state-protocol` 的前置条件。

## Checklist

- [ ] 1. 编写 sidecar packaging spike，加入 `@yao-pkg/pkg` 和必要的单文件 bundle/asset 配置。
- [ ] 2. 让 FTS5 WASM、Agent 依赖及平台原生可选资产在 executable 中可解析；实现 ready/ping/FTS smoke。
- [ ] 3. 若 pkg spike 失败，按设计切换到固定 Node runtime + resources，并保留相同 target/smoke 合同。
- [ ] 4. 新增 target-aware 构建脚本和根级 `build:sidecar`/`smoke:sidecar`/predev/prebuild 入口；生成产物加入 gitignore。
- [ ] 5. 配置 `bundle.externalBin`、Rust `tauri-plugin-shell`，确保 capabilities 不向前端授予 shell spawn。
- [ ] 6. 建立最小异步 transport：stdout chunk framing、stderr logging、terminated/error、非阻塞 write、ready/ping。
- [ ] 7. 拆分 import/open 轻量元数据命令与 Raw bytes 命令，复用 LibraryStore 文件读取。
- [ ] 8. 更新 TypeScript library types、App/LibraryView/ReaderView，使 EPUB 载荷使用 ArrayBuffer/Uint8Array。
- [ ] 9. 删除未使用的 `greet`、legacy `open_file`、`openEpubFile` 与 JSON bytes DTO/注册。
- [ ] 10. 添加 Raw IPC Rust/前端测试、构建产物命名检查和无 Node PATH 冒烟。
- [ ] 11. 在当前 host triple 运行 Tauri no-bundle build，检查 binary 被识别。

## Validation Commands

```bash
npm run build:sidecar
npm run smoke:sidecar
npm --prefix sidecar test
npm test -- --run
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run tauri build -- --no-bundle
```

## Acceptance Probes

- 将测试进程 PATH 设为只包含 sidecar executable 所需的最小系统路径，确认没有 `node` 仍能 ready/pong。
- 扫描生产 binary/config，不包含 `/home/maplume/projects/Litera` 或其他编译机源码路径作为运行依赖。
- 以大于常见 EPUB 的测试 payload 断言 Tauri IPC body 为 Raw，前端收到 `ArrayBuffer` 而非数字数组。
- fresh clone 模拟目录中删除 `sidecar/dist` 和 `src-tauri/binaries` 后，标准 build 能重新生成产物。

## Risk and Rollback Points

- 风险集中在 sidecar 依赖的动态资源发现和不同 target 的 binary 生成。
- 先完成独立 executable smoke，再改 Rust runtime；先完成 Rust Raw response 测试，再改前端调用。
- 本子任务完成后建立 RP2 提交；后续 protocol 子任务不得重新引入源码路径或系统 Node fallback。
