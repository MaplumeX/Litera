# Spec: Android app

Status: ready-for-agent

## Problem Statement

Litera is desktop-only (macOS, Windows, Linux). A reader who wants a good EPUB reader on an Android phone has to use a different app. That app has its own library, its own highlights, and no reading assistant, so the Library, Annotations and Sessions they built up in Litera stay on the desktop. Litera's own Sync and KOReader Sync don't help, because there is no Litera on the phone to sync to.

## Solution

Ship Litera for Android phones as a **full, standalone EPUB reader**. On the phone the reader can import books, read with bookmarks, highlights and notes, change typography, and talk to the reading assistant, all without any desktop install. Sync (S3) and KOReader Sync are opt-in, exactly as on desktop. When Sync is on, the phone becomes one more device in the same Library.

The app is built from the same codebase on Tauri 2's Android target (ADR 0002). It gets a mobile shell designed for portrait phones: a page stack, touch paging, an assistant bottom sheet, and Android back and immersive behaviour. Tablets and other wide screens keep the desktop shell. The first release ships as a signed `arm64-v8a` APK on the same GitHub Release as desktop, with the same version number.

## User Stories

### Install and first run

1. As an Android reader, I want to download a signed APK from the GitHub Release, so that I can install Litera without an app store.
2. As an Android reader, I want the Android build to carry the same version number as desktop, so that I know which features and Sync format each device runs.
3. As an Android reader, I want later APKs to install over the previous one, so that my Library survives updates.
4. As an Android reader, I want the app to work fully without configuring Sync or an LLM provider, so that I can use it simply as an EPUB reader.
5. As an Android reader with a phone from roughly the last eight years (Android 7.0+, 64-bit ARM), I want the app to install and run, so that I don't need a new device.

### Library

6. As an Android reader, I want my Library as a grid or list of book cards, so that I can browse my books on a narrow screen.
7. As an Android reader, I want a horizontally scrolling "Continue reading" row at the top, so that I can get back to recent Books in one tap.
8. As an Android reader, I want a search box at the top of the Library, so that I can find a Book by title or author.
9. As an Android reader, I want the same sort options as desktop (recently opened, title, author, date added, progress), so that the Library is ordered the way I expect.
10. As an Android reader, I want the Library filters (Reading status, Starred) in a left drawer behind a menu button, so that they don't take up screen width.
11. As an Android reader, I want Trash ("Recently deleted" / 回收站) and Settings reachable from that drawer, so that I always know where to find them.
12. As an Android reader, I want to long-press a book card to open its actions (details, edit metadata, change Reading status, star, delete), so that I can manage a Book without opening it.
13. As an Android reader, I want to edit a Book's title, author and cover, so that badly tagged EPUBs look right on my shelf.
14. As an Android reader, I want a deleted Book to go to the Trash for 30 days and be restorable, so that a mistaken delete isn't permanent.
15. As an Android reader, I want Reading status to follow the same lifecycle as desktop (unread on import, reading on first page turn, finished only after I confirm), so that my statuses mean the same thing on every device.

### Importing books

16. As an Android reader, I want an Import button that opens the system file picker with multi-select, so that I can add EPUBs from anywhere on my phone or cloud drives.
17. As an Android reader, I want to choose Litera in "Open with" when I tap an EPUB in a file manager or download list, so that new books land in my Library straight away.
18. As an Android reader, I want to share an EPUB from another app (browser, chat app, email) to Litera, so that importing an attachment takes one step.
19. As an Android reader, I want importing the same EPUB a second time to be recognised as the same Book, so that my Library doesn't fill with duplicates.
20. As an Android reader, I want clear feedback when an import succeeds, is a duplicate, or fails (not an EPUB, corrupt file), so that I know what happened.
21. As an Android reader, I want imported Books stored privately inside the app, so that they don't clutter my public storage and other apps can't read them.

### Reading

22. As an Android reader, I want to turn pages by tapping the left or right third of the screen, so that I can read with one hand.
23. As an Android reader, I want to turn pages by swiping left or right, so that paging feels like other mobile readers.
24. As an Android reader, I want a tap in the middle of the page to show or hide the reader toolbars, so that the page is chrome-free while I read.
25. As an Android reader, I want the status bar and navigation bar hidden while the toolbars are hidden (immersive mode), so that the whole screen is used for text.
26. As an Android reader, I want an optional setting to turn pages with the volume keys (off by default), so that I can page without touching the screen.
27. As an Android reader, I want an optional "keep screen on while reading" setting (off by default), so that the screen doesn't time out mid-page.
28. As an Android reader, I want the reader to follow the system's rotation setting, so that I can read in landscape if I want.
29. As an Android reader, I want my position restored to the last passage when I reopen a Book, so that I continue exactly where I stopped.
30. As an Android reader, I want the nested table of contents from the toolbar, so that I can jump between chapters.
31. As an Android reader, I want a progress bar or slider in the toolbar, so that I can see where I am and seek.
32. As an Android reader, I want footnotes to open in a popup instead of jumping away, so that I don't lose my place.
33. As an Android reader, I want to tap an image in the Book to view it full screen with zoom, so that I can read diagrams on a small screen.
34. As an Android reader, I want in-book search, so that I can find a passage.
35. As an Android reader, I want to be asked before finishing a Book is recorded, as on desktop, so that Reading status stays accurate.

### Selection and Annotations

36. As an Android reader, I want to long-press a word to start a selection and drag handles to adjust it, so that I can select passages precisely by touch.
37. As an Android reader, I want the selection toolbar (highlight colours, note, ask the assistant) to appear above the selection, so that I can act on it immediately.
38. As an Android reader, I want to add a Bookmark to the current page from the toolbar, so that I can mark places to return to.
39. As an Android reader, I want to see and edit a highlight's note by tapping the highlight, so that I can revise my thoughts.
40. As an Android reader, I want an Annotations list (bookmarks, highlights, notes) for the Book, so that I can review them and jump to any of them.

### Typography and theme

41. As an Android reader, I want to change font size, line height, measure, padding, tracking, paragraph spacing, first-line indent and alignment, so that the page reads comfortably on my screen.
42. As an Android reader, I want to pick a serif, sans-serif or monospace family, or keep the Book's embedded fonts, so that I can control the typeface without browsing system font files.
43. As an Android reader, I want the existing overrides for the Book's embedded fonts and chapter layout, so that badly styled EPUBs can be fixed.
44. As an Android reader, I want light, dark and system themes, so that I can read at night.
45. As an Android reader, I want my typography preferences to sync like they do between desktops, so that the Book looks the same everywhere (when Sync is on).

### Reading assistant

46. As an Android reader, I want to open the assistant as a bottom sheet over the Book, so that I can ask questions without leaving the page.
47. As an Android reader, I want to drag the assistant sheet between half height and full screen, so that I can see the passage at half height or focus on the conversation at full screen.
48. As an Android reader, I want "Ask" on the selection toolbar to open the sheet with the selected passage attached, so that asking about a passage is one tap.
49. As an Android reader, I want each Book to remember whether I last used the assistant collapsed or full screen (its mobile counterpart to Reading/Agent mode), so that the Book reopens the way I left it.
50. As an Android reader, I want to create, switch between, rename and branch Sessions, so that I have the same Session model as desktop.
51. As an Android reader, I want edit-and-resend, the per-Session system prompt, and the thinking level, so that I lose no assistant control on the phone.
52. As an Android reader, I want Citations shown with their verification state and tappable to jump to the quoted passage, so that I can check the assistant against the Book.
53. As an Android reader, I want Mind Maps to render inside the Session and be pannable and zoomable by touch, so that outlines are readable on a phone.
54. As an Android reader, I want the assistant to view Book images when the model supports vision, as on desktop, so that it can explain figures.
55. As an Android reader, I want Compaction notices and long Sessions to work as on desktop, so that long conversations don't break.
56. As an Android reader, I want to configure LLM providers (built-in and OpenAI-compatible endpoints) in Settings, so that I can use my own API key on the phone.
57. As an Android reader, I want the on-screen keyboard to push the composer up rather than cover it, so that I can see what I'm typing.

### Sync (S3)

58. As an Android reader, I want to enable Sync with my existing S3-compatible Sync Backend, so that the phone joins my Library.
59. As an Android reader on a new device, I want the shelf to appear as soon as the Manifest is pulled, with not-yet-downloaded Books marked "not cached", so that I can see my whole Library right away.
60. As an Android reader, I want a not-cached Book to download when I open it, so that I only use storage for Books I read.
61. As an Android reader, I want Sync to pull and merge when the app comes back to the foreground, so that the phone shows what I just did on the desktop.
62. As an Android reader, I want pending changes pushed when the app goes to the background, so that my progress reaches the desktop even if Android kills the app later.
63. As an Android reader, I want a "transfer book files only on Wi-Fi" setting, so that large EPUB uploads and downloads don't eat my mobile data.
64. As an Android reader on mobile data with that setting on, I want opening a not-cached Book to tell me its size and ask before downloading, so that I decide whether it's worth it.
65. As an Android reader, I want the Manifest and Sessions to keep syncing on any network, so that positions and Annotations stay current even on mobile data.
66. As an Android reader, I want deletions, revivals and merges to behave exactly as they do between desktops (Tombstones, item-level merges), so that the phone never corrupts or resurrects data.

### KOReader Sync

67. As an Android reader, I want to enable KOReader Sync with a Progress Server, so that my position is exchanged with KOReader and BookOrbit.
68. As an Android reader, I want Litera to push my position shortly after I stop reading, and to ask before jumping to a newer position when I open a Book, as on desktop, so that I move between devices smoothly.

### Navigation and system behaviour

69. As an Android reader, I want the system Back gesture to close the innermost layer first (dialog or selection toolbar, then assistant sheet, then reader toolbars, then the reader itself back to the Library), so that Back always does the expected thing.
70. As an Android reader, I want Back on the Library screen to exit the app, so that it behaves like other Android apps.
71. As an Android reader, I want the UI in English or Simplified Chinese, matching desktop, so that I can use my language.
72. As an Android reader, I want desktop-only settings (window controls, system font list, file association) hidden, so that Settings only shows what applies to the phone.
73. As an Android tablet reader, I want the desktop layout on a wide screen, so that I can use the extra space.

### Privacy

74. As a privacy-conscious reader, I want Android's automatic cloud backup disabled for Litera, so that my LLM API keys and S3 credentials never leave the device, as the README promises.
75. As a reader, I want it made clear that uninstalling Litera deletes its imported Books, so that I'm not surprised.

### Maintainer

76. As the maintainer, I want CI to build and sign the Android APK from a keystore in repository secrets and attach it to the Release, so that releases need no manual Android steps.
77. As the maintainer, I want CI to type-check the Rust crate for the Android target, so that desktop changes can't silently break the Android build.
78. As the maintainer, I want desktop-only Rust code gated by target, with Android counterparts behind the same commands, so that the frontend calls one API on both platforms.

## Implementation Decisions

### Platform and build

- Target Tauri 2's Android output in the existing repository and app identifier. Initialise the Android project with the Tauri CLI. minSdk 24 (Tauri's default). Only `arm64-v8a` is built.
- Version stays single-sourced: the existing version-bump flow also updates the Android version name/code. One GitHub Release carries the desktop artefacts and the APK.
- Release CI gets an Android job: Android SDK/NDK, Rust `aarch64-linux-android` target, an APK signed with a keystore and passwords from repository secrets. The maintainer generates and backs up the keystore. Losing it breaks in-place upgrades for every user.
- Regular CI adds a Rust check against `aarch64-linux-android`, so that `cfg`-gated code compiles on both sides.
- Android auto-backup is disabled in the manifest (`allowBackup=false`). Credentials stay in the same local JSON files as on desktop, inside app-private storage.
- The asset protocol scope and the books directory resolve through the existing app-data-dir lookup. On Android that is app-private internal storage, so uninstalling removes it.

### Rust backend

- Desktop-only plugins (single-instance, window-state) are already target-gated. Path-based open handling (process args, second instance, opened URLs) stays desktop-only.
- **System fonts**: the system-font listing command keeps its signature. On Android it returns the fixed generic families (serif, sans-serif, monospace) instead of enumerating through `font-kit`. `font-kit` becomes a desktop-only dependency.
- **Import without a path**: Library import gains a path-less entry point that takes bytes plus a display file name (from the picker, the `VIEW` intent or the `SEND` intent). Books imported this way get no `source_key`. Duplicates are found only by the content-derived Book id, so importing the same EPUB again resolves to the existing Book. The desktop path-based import and its `source_key` overwrite behaviour are unchanged.
- Export stays registered, but the mobile shell doesn't surface it (deferred).
- Sync, KOReader Sync, the Manifest format and the merge rules are unchanged. The phone is just another device id. `object_store`, `reqwest` (rustls) and `md-5` must build for Android. If a dependency doesn't, fix that, not the Sync design.

### Native Android plugin

One small, Litera-owned Tauri mobile plugin (Kotlin) provides what the WebView lacks. All of it goes to the frontend through a single **platform event bridge**:
- **Events**: `back` (system Back), `volumeKey` (up/down; only intercepted while the reader is active and the setting is on, otherwise the system handles volume), `lifecycle` (foreground/background), `incomingBooks` (bytes or readable handles plus a file name, from `VIEW`/`SEND` intents, including a cold start).
- **Commands**: open the system document picker (multi-select, EPUB MIME types) and return file bytes and names; set immersive mode on/off; set keep-screen-on on/off; query whether the active network is Wi-Fi/unmetered.
- On desktop the bridge is a no-op implementation (or maps to existing mechanisms), so shared code can depend on it unconditionally.

### Frontend: mobile shell

- At startup the app picks a shell: Android on a narrow viewport → **mobile shell**; everything else (desktop, Android tablets and wide screens) → existing desktop shell. The platform detection module grows an Android/mobile check next to its current desktop-OS detection.
- The mobile shell is a separate component tree. It reuses the shared library/reader/agent/sync logic, foliate-js, the reader view's rendering core, the dialogs and the UI primitives. It doesn't reuse the desktop panel layout (resizable panels, side panels, window controls).
- **Navigation model**: a page stack of Library → Reader, plus Settings and Trash as pages. Overlays (dialogs, selection toolbar, assistant sheet, reader toolbars) form a layered stack that the `back` event pops in this order: dialog/selection → assistant sheet → reader toolbars → Reader page. `back` on the Library page with nothing open exits the app.
- **Library page**: top bar with search, sort and grid/list toggle; a "Continue reading" row; a left drawer holding the filters (Reading status, Starred), Trash and Settings; long-press on a card opens the existing book actions and status menus as a sheet.
- **Reader page**: tap zones (left/right third page, middle toggles chrome), horizontal swipe paging, long-press selection with native handles, toolbars (top: back, title, TOC, search, bookmark, Annotations, typography, assistant; bottom: progress). Chrome visibility drives immersive mode. The keep-screen-on setting applies while the Reader page is shown.
- **Paging logic** extends the existing reader-paging module rather than adding a new one: the hit-zone and key-action functions learn touch taps, swipe gestures and volume-key input, behind the same "ignore interactive targets" rules.
- **Assistant bottom sheet**: three snap states (collapsed, half, full). Half keeps the Book visible above it. The per-Book reader-mode preference maps to collapsed ↔ Reading and full ↔ Agent, so one stored preference serves both shells. The composer stays above the on-screen keyboard. Mind Maps support touch pan and pinch zoom.
- **Settings page**: the existing settings sections in a single-column, touch-sized layout, without desktop-only controls. It adds Android-only settings: volume-key paging (default off), keep screen on (default off), Wi-Fi-only book-file transfer (default on, mobile shell only).
- **Typography**: the font picker shows serif / sans-serif / monospace / the Book's embedded fonts, populated from the same font-listing command.

### Sync lifecycle on Android

- Driven by the bridge's `lifecycle` event: on **foreground**, run a sync (pull and merge, then push); on **background**, push pending changes with the same short timeout the desktop uses on window close. While in the foreground, the desktop's existing triggers and cadence apply. No background scheduled sync.
- The sync runner gets an option to sync the Manifest and Sessions without transferring book files. When "Wi-Fi only" is on and the network is metered, the mobile shell runs Sync with book-file transfer off.
- Opening a not-cached Book on a metered network with "Wi-Fi only" on shows a confirm with the file size before downloading. Declining keeps the Book not cached.

### Docs

- README / README.zh-CN: add Android to platforms and install instructions, mention that uninstalling deletes imported Books, and explain the Wi-Fi-only setting. The privacy promise stays true because auto-backup is off.
- CONTEXT.md and ADR 0002 are already updated.

## Testing Decisions

A good test drives the feature the way a reader would and asserts what the reader sees: which page is shown, what an action does, which backend commands were invoked with what data. It doesn't assert component internals, state shapes, or the order of private helper calls. Mocks sit only at the process boundary: `invoke` from `@tauri-apps/api/core`, plus the new platform event bridge.

- **S1: mobile shell, app-level (primary seam).** Render the mobile shell with `invoke` and the platform event bridge mocked, the way the existing `App.reader-mode` / `App.reading-position` / `App.annotations` / `App.sync-files` tests mock `invoke` and the window API. Cover: Library → Reader → back navigation; the full `back` layering order, including exit on Library; middle tap toggling chrome and the matching immersive-mode command; assistant sheet snap states and the per-Book mode memory; Import button → picker result → path-less import command; `incomingBooks` (warm and cold start) → import; duplicate import feedback; `lifecycle` foreground → sync run and background → push; the Wi-Fi-only rule (metered network → sync without files; opening a not-cached Book → size confirm); volume-key paging only when enabled and only in the Reader; desktop-only settings absent.
- **S2: existing pure modules.** Extend `reader-paging` tests for tap zones, swipe and volume-key actions, following the current `reader-paging.test.ts`. Extend `sync-runner` tests for the "no book files" option, following `sync-runner.test.ts`. Shell selection (Android + narrow → mobile shell) is tested in the platform module's tests.
- **S3: Rust `LibraryStore` unit tests.** Following the existing import tests in the library module: a path-less import creates a Book with no `source_key`; importing identical bytes again resolves to the same Book id; the desktop path import behaviour is unchanged. The Android font-listing branch is trivial and covered by the CI Android check.
- **Not automated:** the Kotlin plugin (intents, volume keys, immersive mode, picker, network type), gesture feel, keyboard insets and on-device performance. The maintainer verifies these by hand on a real phone before each release.
- CI runs the frontend tests, the Rust tests and the Rust check for the Android target on every change.

## Out of Scope

- Read-aloud (TTS) on Android: it needs a native text-to-speech plugin because the WebView has no `speechSynthesis`. Follow-up.
- Export on Android (choosing a destination via the system share sheet or file picker). Follow-up.
- Importing custom font files (TTF/OTF) and bundling fonts in the APK. Follow-up.
- Scanning or watching a folder (e.g. `Download/`, `Books/`) for EPUBs.
- Background scheduled Sync (WorkManager) and push-based Sync.
- Google Play and F-Droid distribution, and in-app update checks.
- `armeabi-v7a` and `x86_64` builds.
- An iOS app.
- A tablet-specific layout beyond reusing the desktop shell on wide screens, and a landscape-specific phone layout.
- Any change to the Manifest format, the merge rules, or the KOReader Sync protocol.

## Further Notes

- ADR 0002 records why the app uses Tauri on Android instead of a native app. ADR 0001's Sync rules apply unchanged; the phone is just another device.
- Highest-risk unknowns, worth spiking first: whether `object_store` (aws), `reqwest` (rustls) and the image crate build cleanly for `aarch64-linux-android`; long-press selection and handle behaviour in foliate-js's paginated iframe on Android WebView; swipe paging vs. text selection conflicts; and whether the LLM HTTP plugin streams correctly on Android.
- Suggested order: (1) Android build plus CI check and a signed APK showing the existing UI; (2) platform bridge plus mobile shell skeleton (page stack, back); (3) Library plus import paths; (4) Reader touch paging, chrome and immersive mode; (5) selection, Annotations and typography; (6) assistant sheet; (7) Sync lifecycle and the Wi-Fi rule; (8) KOReader Sync and Settings polish; (9) release job and README.
