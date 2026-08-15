# Implement: Beautify desktop reader UI

## Checklist

1. **Foundation**
   - Install `@fontsource-variable/geist`.
   - Import `wght.css` in `src/main.tsx`.
   - Set `--font-sans` + CJK fallbacks and retune color / radius tokens in `src/index.css`.
   - Confirm body chrome uses the new sans. Confirm `generateStylesCss` is untouched.

2. **Shared primitives**
   - Only touch `src/components/ui/*` when a token cannot express the look (e.g. leftover shadow utilities).
   - Keep variants, sizes, and `data-slot` intact.

3. **Library**
   - `LibraryView`: search field, header type, empty/no-match states.
   - `BookCard`: no card shadow, lucide delete, flat missing-cover, quieter progress.

4. **Reader chrome**
   - `App.tsx` header/drawers, `ReaderProgressBar`, `TocSidebar`, `AnnotationsSidebar`, `SelectionToolbar`, `WindowControls`.
   - Do not change grid areas, widths, drag handles, or mode switching.

5. **Chat**
   - `ChatPanel`, `ChatInput`, `MessageBubble`, `AssistantMessage`, `EmptyState`, `SessionList`, `ToolCallCard`.
   - Keep stick-to-bottom, action-row height, `fillInput` behavior.

6. **Settings**
   - `SettingsDialog`, `AgentConfigDialog` / `AgentConfigForm`.
   - Keep segmented controls, dialog fixed size, settings entry ownership.

7. **Copy and tests**
   - Any new chrome string goes through `useT()`.
   - Update tests that pin removed decorative classes. Do not weaken behavior assertions.

## Validation

```bash
npm test
npx tsc --noEmit
npm run build
```

Manual (Tauri WebView, not a browser tab):

- Library empty + with books, light and dark
- Open a book: reader header, progress seek, TOC, 标注, selection toolbar
- Docked chat and Agent workspace
- Settings 排版 / 外观 / AI; agent config dialog
- zh-CN and en; Chinese chrome must not tofu

## Risky files

- `src/index.css`: global; a bad token breaks every screen
- `src/App.tsx`: easy to nudge layout while restyling drawers
- `src/lib/reader-styles.ts`: do not edit unless a bug proves chrome leaked into the iframe
- Component tests that snapshot class names

## Rollback

`git checkout` the touched frontend files; `npm uninstall @fontsource-variable/geist`.

## Ready for start

- `prd.md`, `design.md`, `implement.md` exist
- `implement.jsonl` / `check.jsonl` need real spec + research entries before `task.py start`
- User must approve this planning summary in a later message
