# Litera

**English** | [简体中文](README.zh-CN.md)

An EPUB reader for desktop and Android with a built-in reading assistant. Books stay on your machine until you enable Sync; the assistant only talks to the LLM provider you configure.

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
- On Android, import your own TrueType / OpenType fonts (Settings → Typography → Import fonts…); they stay on that device
- Optional overrides for the book’s embedded fonts and chapter layout (independently)
- Light / dark / system theme; UI font and size are separate from the page

### Sync (opt-in)

- Mirror your library across devices via any S3-compatible bucket you own (AWS S3, Cloudflare R2, Backblaze B2, MinIO, ...)
- Reading positions, bookmarks, highlights and notes, and assistant sessions converge automatically (theme, language, and typography stay per device, since desktop and phone screens differ); merges are item-level (nothing is clobbered by whole-database overwrites)
- Large books upload with multipart; new devices download the Manifest first and fetch book files on demand
- Off by default. Synced data is stored as-is (plaintext) on the bucket you choose; LLM API keys and S3 credentials never leave the device
- On Android, **Settings → This device → Transfer book files only on Wi-Fi** (on by default) keeps EPUB uploads and downloads off mobile data; positions, annotations and sessions still sync. Opening a book that isn't on the phone yet over mobile data asks first and shows its size

### KOReader Sync (opt-in)

- Exchange reading progress with KOReader through any kosync-compatible progress server: KOReader's own (`https://sync.koreader.rocks`), a self-hosted `koreader-sync-server`, or [BookOrbit](https://github.com/bookorbit/bookorbit) (`https://<host>/api/v1/koreader`, using the KOReader credentials created in BookOrbit)
- Litera pushes your position shortly after you stop reading and asks before jumping to a newer position from another device when you open a book
- Progress only, not annotations. Books are matched by KOReader's file fingerprint, so every side needs the same EPUB file
- Off by default; separate from Sync. Settings → Sync → KOReader Sync

### Reading assistant

- Two layouts: **Reading** (book first) and **Agent** (conversation first). Each book remembers the last mode
- Select a passage and ask, or just type a question
- The assistant can look up metadata, the TOC, chapter windows, in-book search, and your bookmarks/highlights
- Multiple sessions per book: create, switch, rename, edit-and-resend
- Per-session system prompt (appended to the default, so reading tools stay intact)
- Thinking level (off → max); models without thinking degrade safely
- Long chats are summarized instead of hard-truncated
- Built-in providers (Anthropic, OpenAI, DeepSeek, Google, OpenRouter, Groq, Mistral, xAI, Together, Fireworks) plus any OpenAI-compatible endpoint (Ollama, etc.)
- Sign in with ChatGPT to run the assistant on your ChatGPT plan, no API key needed

### App

- English and Simplified Chinese
- Window size and position restore on launch
- macOS, Windows, Linux, and Android (phones get a touch layout: tap or swipe to turn pages, the assistant as a bottom sheet; tablets keep the desktop layout)

## Install

Download the latest build from [Releases](https://github.com/MaplumeX/Litera/releases):

| Platform | Package |
| --- | --- |
| Linux | `.AppImage`, `.deb` |
| macOS | `.dmg` (Apple Silicon) |
| Windows | NSIS installer |
| Android 7.0+ (64-bit ARM) | `.apk` — allow installing from your browser or file manager, then open it. Later APKs install over the previous one and keep your Library |

On Android, imported books are stored privately inside the app, so **uninstalling Litera deletes them** (synced books can be downloaded again). Android backup is disabled for Litera, so API keys and S3 credentials stay on the phone.

## Quick start

1. Import an EPUB into the library (or open one from the file manager; on Android, "Open with" or share it to Litera).
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

### Android

Needs the Android SDK and NDK (`ANDROID_HOME`, `NDK_HOME`), JDK 17+ and the Rust target `aarch64-linux-android` (see the [Tauri Android prerequisites](https://v2.tauri.app/start/prerequisites/#android)).

```bash
npm run tauri android dev                              # run on a connected phone or emulator
npm run tauri android build -- --apk --target aarch64  # release APK
```

The APK's version name and code come from `tauri.conf.json`, so `npm run version:bump` covers Android too. Release CI signs the APK with the keystore in the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets. Keep a backup of that keystore: an APK signed with a different key cannot install over the old one.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

This repository does not currently include a top-level license file. [foliate-js](https://github.com/johnfactotum/foliate-js) is MIT-licensed.
