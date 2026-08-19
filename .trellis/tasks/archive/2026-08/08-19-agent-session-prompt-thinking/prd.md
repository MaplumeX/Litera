# Agent 每会话系统提示词与思考强度配置

## Goal

让 Litera 的阅读助手支持**每会话自定义系统提示词**和**每会话思考强度(含 max 等级)**,取代当前硬编码的系统提示词与固定关闭的思考,让用户能为不同会话(如古文翻译、人物分析)配置不同的助手行为。

## 背景(已确认事实)

- 当前系统提示词是 `embedded-runtime.ts` 第 22 行硬编码的英文常量 `SYSTEM_PROMPT`,所有会话共用,用户不可改。
- 当前思考强度在 `ensureAgent` 中硬编码为 `thinkingLevel: "off"`。
- `@earendil-works/pi-agent-core` 0.84.1 原生支持 `ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`(包含 max)。
- `@earendil-works/pi-ai` 提供 `clampThinkingLevel(model, level)`(仅 `reasoning: true` 的模型支持非 off 等级;不支持的等级钳到最近可用,最坏回退 `"off"`)。
- 会话持久化:每个书每会话一个 JSONL 文件(`src-tauri/src/pi_sessions.rs`),entry 树结构(`id/parentId/timestamp/type`),现有 entry 类型:message、custom_message、compaction、branch_summary、session_info(重命名用,含 `name` 字段)。`validate_entry` 不拒绝未知类型。
- 前端会话 UI:`SessionList`(条目内已有重命名/删除按钮)+ `ChatPanel`(头部设置按钮打开全局 `AgentConfigDialog`)。
- i18n:`src/locales/zh-CN.ts` / `en.ts`,key 前缀 `chat.*`。

## Requirements

### R1 每会话系统提示词(纯会话级)

- 每个会话可以设置自己的系统提示词(替代/覆盖默认提示词 `SYSTEM_PROMPT`)。
- 未设置或清空时,使用默认提示词。
- 新建会话时提示词为空(用默认),不继承任何全局设置;用户逐个会话设置。
- UI 入口(已确认:方案 A):`SessionList` 每个会话条目内新增"会话设置"按钮(与重命名/删除并列),点击打开该会话的设置弹窗。
- 系统提示词随会话持久化,切换会话/重启应用后各自独立保留生效。

### R2 每会话思考强度

- 每个会话可设置思考强度,等级完整覆盖:`off / minimal / low / medium / high / xhigh / max`。
- 未设置时默认 `off`(保持现状)。
- 思考强度随会话持久化,切换会话后生效。
- 运行时按模型元数据经 `clampThinkingLevel` 钳制,对不支持思考的模型安全降级,不得报错。

## 设计约束

- 沿用现有 entry 持久化机制(新增 `session_config` entry 类型,复用 `append_agent_session_entries`),不破坏旧会话文件可读性。
- 配置变更立即生效(下一条 prompt 使用新配置),不强制重启。
- 保持现有 UI 风格与 i18n 体系。
- 全局(应用级)模型与 API 配置不变,仍走 `AgentConfigDialog`。

## Acceptance Criteria

- [ ] AC1: 会话列表中每个会话条目有"会话设置"按钮,点击打开会话设置弹窗,可编辑系统提示词(含清空/恢复默认),保存后持久化到会话文件。
- [ ] AC2: 切换会话后各会话系统提示词独立生效;重启应用后仍保留。
- [ ] AC3: 会话设置弹窗含思考强度选择,选项完整覆盖 `off` 到 `max`。
- [ ] AC4: 思考强度随会话持久化,切换会话/重启后保留;未设置时默认 off。
- [ ] AC5: 运行时对思考强度经 `clampThinkingLevel` 钳制,不支持的模型安全降级(不报错)。
- [ ] AC6: 全量测试通过(现有 369+ 测试),`npx tsc --noEmit` 无错误。

## Out of Scope

- 全局(应用级)系统提示词设置 —— 本次只做每会话。
- 新建会话继承"默认提示词"模板 —— 方案 1 已确认不做。
- 温度等其它采样参数配置。
- 会话级模型选择(仍用全局配置的模型)。
