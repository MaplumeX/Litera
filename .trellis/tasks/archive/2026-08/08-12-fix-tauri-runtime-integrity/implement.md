# Integration Plan

## Ordered Checklist

- [x] 1. 审核父/子 PRD、设计和上下文清单，确认无开放产品决策。
- [x] 2. 启动并完成 `08-12-fix-library-persistence-safety`，运行其全部 Rust/前端测试与检查。
- [x] 3. 启动并完成 `08-12-fix-sidecar-packaging-ipc`，验证 Raw IPC 与 self-contained sidecar 冒烟。
- [x] 4. 启动并完成 `08-12-fix-sidecar-state-protocol`，验证状态机、supervisor、事件 reducer 和 StrictMode 生命周期。
- [x] 5. 执行父任务跨层审查：命令签名、serde/TS 类型、protocol envelope、CSP、capabilities、构建脚本和错误路径一致。
- [x] 6. 在临时 app-data 根演练 legacy reset：成功备份、备份失败保护、空新库启动。
- [x] 7. 在无系统 Node 的受控 PATH 下运行已打包 sidecar ready/ping；验证 Tauri 构建包含 target-triple executable。
- [x] 8. 运行全量质量门禁并修复所有失败。
- [x] 9. 更新 `.trellis/spec/backend/*` 与 `.trellis/spec/frontend/*` 中已过时的同步命令、sidecar 路径、监听和字节协议约定。
- [x] 10. 检查 git diff、提交各子任务和父任务集成记录，然后按 Trellis finish 流程归档。

## Full Validation Commands

```bash
npm run build
npm test
npm --prefix sidecar run build
npm --prefix sidecar test
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run build:sidecar
npm run smoke:sidecar
npm run tauri build -- --no-bundle
```

具体脚本名可在子任务实现时落地，但最终必须提供等价的一键检查入口。

## Integration Review Gates

- 子任务不能仅因自身测试通过而归档；必须检查其输出契约是否满足后续子任务依赖。
- 任一事件/命令字段变化必须同时更新 Rust、sidecar、TypeScript 类型和规格。
- 任一持久化失败路径都必须证明不会用空状态覆盖原文件。
- 任一发布修复都必须用实际生成的 sidecar binary 冒烟，不能只检查配置文本。

## Rollback Points

- RP1：Library child 完成并提交后。
- RP2：Packaging/IPC child 完成并提交后。
- RP3：State protocol child 完成并提交后。
- 任一阶段失败回滚到最近 RP，不跨阶段保留不完整协议。
