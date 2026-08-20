# 为 agent 压缩触发添加 UI 指示

## Goal

当 agent 的上下文压缩（compaction）触发时，向用户给出可见的 UI 指示，消除当前"静默压缩、看起来像卡住"的体验问题。

## Background

litera 的 agent runtime 在 `maybeCompact`（`src/agent/runtime/embedded-runtime.ts:105`）中执行上下文压缩，会在 prompt 流程中调用 LLM 生成摘要，可能耗时数秒。当前整个过程不 emit 任何事件，`AgentEvent` 联合类型（`src/types/agent.ts:51`）也没有压缩相关变体，UI 层完全无感知。

市面共识（Claude Code、Cursor、Cline、agor、t3code 等）：静默压缩被一致批评，瞬时 toast 太易错过，主流方案是聊天流内联时间线 chip + 进行中 spinner + 完成后保留为历史边界标记。

## Requirements

- R1 压缩开始时，在聊天流中显示进行中指示（spinner + "正在压缩上下文…"）
- R2 压缩完成后，指示变为完成态（"上下文已压缩"），并保留在对话流中作为历史标记
- R3 chip 视觉应轻于普通消息（小字号、muted 色、居中），不打断对话视觉流
- R4 压缩失败时（maybeCompact 已 swallow 错误）不显示完成态，进行中态自动消除
- R5 中英文 i18n 文案齐全

## Out of Scope

- 上下文用量百分比指示 / 常驻 meter（单独功能，不在此任务）
- 手动触发压缩按钮
- 压缩摘要内容查看

## Acceptance Criteria

- [ ] AC1 压缩触发时聊天流出现居中 chip + spinner，文案"正在压缩上下文…"（中）/"Compacting context…"（英）
- [ ] AC2 压缩完成后 chip 变为"上下文已压缩"（中）/"Context compacted"（英），无 spinner，保留在流中
- [ ] AC3 chip 视觉比普通消息轻（muted 色、小字号、居中、无边框气泡）
- [ ] AC4 压缩失败时不残留进行中态
- [ ] AC5 现有测试通过，新增 compaction 指示相关测试

## Notes

- maybeCompact 在 prompt 流程中调用两次（prompt 前 L72、prompt 后 L91），均可能触发压缩
- maybeCompact 当前吞掉所有错误（catch{return false}），失败时需确保进行中态被清除