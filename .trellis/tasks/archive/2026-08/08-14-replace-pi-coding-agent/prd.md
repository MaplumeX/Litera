# Replace pi-coding-agent and remove sidecar

## Goal

将 Litera 的 Agent Runtime 从独立 Node sidecar 迁入 Tauri WebView，直接使用
`pi-ai` 与 `pi-agent-core`，移除 `pi-coding-agent`、sidecar 进程、Rust
supervisor 和 JSONL 进程协议，同时保留现有阅读 Agent 的用户能力。

用户价值：减少独立二进制构建、进程协议和跨平台发布复杂度，并为未来移动端
运行建立浏览器兼容的 Agent 边界。

## Background and Confirmed Facts

- 当前调用链为 React → Tauri command/event → Rust `SidecarSupervisor` →
  stdin/stdout JSONL → `litera-sidecar` → `pi-coding-agent`。
- sidecar 不只运行 Agent loop；它还负责会话 JSONL、模型配置加载、EPUB 解析、
  章节工具、FTS5 全文检索、book worker、取消与流式事件转换。
- `pi-agent-core` 提供 Agent loop、工具调用和状态管理，但不提供
  `pi-coding-agent` 的 `SessionManager`、`DefaultResourceLoader`、模型配置加载与
  Litera 的进程监督能力；这些职责必须显式重新归位。
- `pi-ai` 已有浏览器打包兼容工作，但当前包元数据仍声明 Node 运行时；迁移必须以
  Litera 的实际 Vite/WebView 构建和真实模型流式调用作为兼容性门槛，不能只以
  TypeScript 编译成功为准。
- Litera 的 API Key、模型和自定义 OpenAI 兼容提供商目前由 Rust 读写
  `<app_data>/agent/{auth,settings,models}.json`；目标架构不应把持久化密钥放入
  `localStorage`。

## Requirements

- R1. 前端内嵌 Agent Runtime 直接依赖同一版本的
  `@earendil-works/pi-ai` 与 `@earendil-works/pi-agent-core`，不再依赖
  `pi-coding-agent`。
- R2. 删除运行时 sidecar 进程以及 Tauri external binary、Rust supervisor、
  stdin/stdout JSONL 协议、sidecar 构建/冒烟/发布流水线。
- R3. 保留现有聊天体验：流式文本、工具开始/结束状态、中止生成、新建/切换/
  删除/重命名会话、编辑历史提问并从该处分支重试。
- R4. 保留阅读工具能力：当前书快照、按章节读取、书内搜索、元数据和目录回退，
  并保持现有 TOC-owned `chapterIndex` / `chapterHref` 坐标契约。
- R5. 会话继续按书隔离并原地使用 Pi session v3 追加式 JSONL；WebView 重载或应用
  重启后通过活动分支重放恢复。不得改成单文件 JSON 快照或浏览器存储。
- R5a. 新实现不得依赖 Node `SessionManager`，但必须兼容现有 Pi v3 header、
  `id`/`parentId` 树、`message`、`session_info`、`custom_message`、模型变化、
  compaction 与 branch summary 语义；v1/v2 文件按 Pi 的公开迁移规则升级到 v3。
- R6. API Key 和提供商配置继续由 Rust 持久化；前端仅在创建请求所需范围内获取
  当前配置，不新增应用自有服务器中转。
- R7. Agent/检索故障不得拖垮阅读器；运行状态、错误和重试行为必须有显式替代
  方案，不沿用含义错误的“sidecar restart”文案或 API。
- R8. 模型请求通过单一、受控的 Tauri native fetch 适配器发出；浏览器 `fetch`
  不作为桌面生产路径。适配器只允许当前激活配置的 HTTP(S) 模型端点，并明确处理
  WebView CORS、CSP 与流式响应差异。

## Acceptance Criteria

- [x] 仓库和发布产物不再包含 `sidecar/`、`litera-sidecar` external binary、
  `pi-coding-agent` 或 sidecar 构建/测试脚本。
- [x] 打开 EPUB 后，Agent 可读取章节、搜索全文并围绕选文/当前章节完成一次带
  工具调用的流式回答。
- [x] 生成可取消；模型、工具或网络错误会转换为可恢复 UI 状态，阅读器保持可用。
- [x] 会话 CRUD、编辑重试、按书隔离和应用重启恢复通过自动化测试及桌面冒烟验证。
- [x] 新会话继续写 Pi session v3 JSONL；正常交互只追加 Pi-compatible 完整记录，
  不按 token 写盘，也不通过原地覆盖修改历史记录。
- [x] 升级后现有 JSONL 会话无需转换到另一套 schema 或目录即可列出、切换、继续
  提问、重命名和编辑分支；v1/v2 fixture 可迁移到 v3。
- [x] 内置提供商和自定义 OpenAI 兼容端点均能读取现有配置并完成请求；API Key
  不写入 `localStorage`、前端日志或会话正文。
- [x] `npm run build`、前端测试、Rust 测试和 Tauri 桌面构建通过；产物启动不要求
  系统安装 Node，也不会拉起额外 Agent 子进程。

## Out of Scope

- 引入 Litera 自有云端代理、账号或同步服务。
- 完整复刻 `pi-coding-agent` 的扩展、skills、prompt templates、compaction 生成器
  和 CLI；只兼容已有 compaction/branch summary 的重放语义。
- 在本任务中交付 Android/iOS 应用；只避免继续依赖桌面 external binary。
- 改造阅读器 UI 或与 Agent 迁移无关的书库功能。

## Compatibility Decision

- 原地复用 Pi session v3 JSONL 磁盘格式和现有 `sessions/<bookId>/` 文件。
- 不依赖或复制 Node `SessionManager` 运行时；由 Rust 实现安全存储，由前端实现
  Pi-compatible 活动分支和上下文投影。
- 保留旧工具调用、隐藏 thinking content、compaction、branch summary 和其他已知
  记录的原始行；UI 只渲染 Litera 支持的可见投影。
