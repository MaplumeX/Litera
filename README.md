# Litera

**English** | [简体中文](README.zh-CN.md)

A desktop EPUB reader with a built-in reading assistant. Books stay on your machine; the assistant only talks to the LLM provider you configure.

![Library](docs/photos/1.png)

![Reader with assistant](docs/photos/2.png)

## Features

### Library

- Import EPUB files from the file picker, drag-and-drop, or the OS “Open with” menu
- Search by title or author; sort by recently opened, title, author, date added, or progress
- Grid and list views, plus a “Continue reading” row of recent books
- Edit title, author, and cover after import
- Replace a file while keeping progress, typography, and chats
- Associate with `.epub` (Windows Explorer can show the book cover when Litera is the default app)

### Reader

- Paginated EPUB layout (wheel, arrow keys, or click the page edges)
- Nested table of contents; progress restores to the last passage, not just the chapter
- Bookmarks and multi-color highlights with notes
- In-place footnote popups instead of jumping to the notes page
- System-voice read-aloud with follow-along highlight and auto page-turn
- Typography: font, size, line height, measure, padding, tracking, paragraph spacing, first-line indent, alignment
- Optional overrides for the book’s embedded fonts and chapter layout (independently)
- Light / dark / system theme; UI font and size are separate from the page

### Reading assistant

- Two layouts: **Reading** (book first) and **Agent** (conversation first). Each book remembers the last mode
- Select a passage and ask, or just type a question
- The assistant can look up metadata, the TOC, chapter windows, in-book search, and your bookmarks/highlights
- Multiple sessions per book: create, switch, rename, edit-and-resend
- Per-session system prompt (appended to the default, so reading tools stay intact)
- Thinking level (off → max); models without thinking degrade safely
- Long chats are summarized instead of hard-truncated
- Built-in providers (Anthropic, OpenAI, DeepSeek, Google, OpenRouter, Groq, Mistral, xAI, Together, Fireworks) plus any OpenAI-compatible endpoint (Ollama, etc.)

### App

- English and Simplified Chinese
- Window size and position restore on launch
- macOS, Windows, and Linux

## Install

Download the latest build from [Releases](https://github.com/MaplumeX/Litera/releases):

| Platform | Package |
| --- | --- |
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` (Apple Silicon) |
| Windows | NSIS installer |

## Quick start

1. Import an EPUB into the library (or open one from the file manager).
2. Open a book and read. Progress, layout, and annotations are saved automatically.
3. To use the assistant: **Settings → AI**, pick a provider, enter an API key and model, then **Save and apply**.
4. In the reader, show the chat panel or switch to Agent mode. Select text and ask, or type freely.

API keys are stored locally. Book files never leave the machine except as context you send to the provider you chose.

## Development

Requires [Node.js](https://nodejs.org/) 22, a recent [Rust](https://rustup.rs/) stable toolchain, and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

Linux extra packages used by this project:

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

If you cloned without submodules:

```bash
git submodule update --init --recursive
```

Useful commands:

```bash
npm test                  # frontend tests (Vitest)
npx tsc --noEmit          # typecheck
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build       # production bundle
```

EPUB rendering comes from [foliate-js](https://github.com/johnfactotum/foliate-js) (`src/foliate-js`). The assistant runtime is [Pi](https://github.com/badlogic/pi-mono) running inside the WebView — there is no sidecar process.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

This repository does not currently include a top-level license file. [foliate-js](https://github.com/johnfactotum/foliate-js) is MIT-licensed.
