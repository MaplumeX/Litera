# Litera

[English](README.md) | **简体中文**

带阅读助手的桌面 EPUB 阅读器。书文件留在本机；助手只请求你配置的 LLM 供应商。

![Litera](public/favicon.png)

## 功能

### 书库

- 通过文件选择、拖放，或系统「打开方式」导入 EPUB
- 按书名 / 作者搜索；按最近打开、书名、作者、导入时间、进度排序
- 网格 / 列表视图，顶部有「继续阅读」（最近打开的书）
- 导入后可改书名、作者、封面
- 替换文件时保留进度、排版和对话
- 关联 `.epub`（Windows 上若 Litera 是默认打开方式，资源管理器会显示封面缩略图）

### 阅读器

- 分页阅读 EPUB（滚轮、方向键，或点左右页边）
- 可折叠的嵌套目录；重开定位到上次看到的那段文字，而不只是章节
- 书签，以及多色高亮与笔记
- 脚注在原文处弹出，不跳到注释页
- 系统语音朗读当前页，支持跟读高亮和自动翻页
- 排版：字体、字号、行距、页宽、边距、字距、段距、首行缩进、对齐
- 「覆盖字体」「覆盖排版」两个独立开关，可压过 EPUB 内嵌字体和章节排版
- 浅色 / 深色 / 跟随系统；界面字体与字号不影响书页

### 阅读助手

- 两种布局：**阅读模式**（书为主）和 **Agent 模式**（对话为主）。每本书记住上次模式
- 选中一段再问，或直接打字
- 助手可按需读元数据、目录、章节窗口、书内检索，以及你的书签和高亮
- 每本书多个会话：新建、切换、重命名、编辑后重发
- 每会话可追加系统提示词（接在默认提示词后面，阅读工具说明会保留）
- 思考强度（off → max）；不支持思考的模型会自动降级
- 对话较长时用摘要压缩历史，而不是硬截断
- 内置供应商（Anthropic、OpenAI、DeepSeek、Google、OpenRouter、Groq、Mistral、xAI、Together、Fireworks），也可加 OpenAI 兼容的自定义端点（如 Ollama）

### 应用

- 简体中文与 English
- 关闭后再开，窗口位置和大小会恢复
- macOS、Windows、Linux

## 安装

从 [Releases](https://github.com/MaplumeX/Litera/releases) 下载最新构建：

| 平台 | 包 |
| --- | --- |
| Linux | `.AppImage`、`.deb` |
| macOS | `.dmg`（Apple Silicon） |
| Windows | NSIS 安装包 |

## 快速开始

1. 把 EPUB 导入书库（或从文件管理器打开）。
2. 打开一本书开始读。进度、排版和标注会自动保存。
3. 要用助手：打开 **设置 → AI**，选供应商，填 API Key 和模型，再 **保存并应用**。
4. 在阅读页打开对话栏，或切到 Agent 模式。选中文字再问，或直接提问。

API Key 存在本机。书文件不会上传，只有你发出去的对话上下文会到所选供应商。

## 开发

需要 [Node.js](https://nodejs.org/) 22、较新的 [Rust](https://rustup.rs/) stable，以及对应系统的 [Tauri 2 依赖](https://v2.tauri.app/start/prerequisites/)。

Linux 额外依赖：

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils \
  libfontconfig1-dev libfreetype6-dev
```

```bash
git clone --recurse-submodules https://github.com/MaplumeX/Litera.git
cd Litera
npm ci
npm run tauri dev
```

若克隆时没带子模块：

```bash
git submodule update --init --recursive
```

常用命令：

```bash
npm test                  # 前端测试（Vitest）
npx tsc --noEmit          # 类型检查
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build       # 生产构建
```

EPUB 渲染来自 [foliate-js](https://github.com/johnfactotum/foliate-js)（`src/foliate-js`）。阅读助手是 WebView 内嵌的 [Pi](https://github.com/badlogic/pi-mono) 运行时，没有外部 sidecar。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

仓库目前没有顶层 LICENSE 文件。[foliate-js](https://github.com/johnfactotum/foliate-js) 为 MIT。
