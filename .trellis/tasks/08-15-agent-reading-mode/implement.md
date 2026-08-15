# Implement: Agent reading mode

## Checklist

1. **Persistence helpers (frontend)**
   - Add `src/lib/reader-mode.ts` (+ test): type `ReaderMode = "reader" | "agent"`, parse/guard, `litera.defaultReaderMode` load/save, invalid → `"reader"`.
   - Add Agent book width helper (or extend an existing width helper): `litera.agent-book-width`, default 38, clamp (~22–60). Mirror `toc-sidebar-width.ts` tests.

2. **Rust per-book field**
   - `BookRecord` + `BookOpenContext`: optional `lastReaderMode`.
   - `update_reading_state`: third independent `Option`; require at least one field; validate `"reader" | "agent"`.
   - Store unit tests: missing ok, invalid → `StorageCorrupt`, write/read round-trip, fraction/settings/mode do not clobber each other.
   - TS `BookRecord` / `BookOpenContext` + `App.tsx` invoke sites.

3. **ChatPanel / SessionList**
   - `SessionList`: overlay vs rail layout. Rail is in-flow, ~240px, not `absolute inset`.
   - `ChatPanel`: `variant` docked | workspace. Workspace shows rail + toggle; hide overlay path. Do not remount the message list when the rail collapses.
   - Tests: rail visible in workspace; overlay still works in docked; new session / switch / rename / delete still fire.

4. **Unified reader shell in `App.tsx`**
   - One `ReaderView`, one `ChatPanel`. Mode changes grid areas/columns only.
   - Reader: book left, chat right (0 when collapsed). Agent: chat left (includes rail), book right (0 when collapsed).
   - Header: mode toggle. Reader keeps chat button. Agent shows sessions + book toggles, hides the old “show chat” meaning (chat is the main pane).
   - Progress: reader = full-width under header; agent = inside book cell.
   - TOC / 标注 stay overlays on the book cell.
   - Resolve mode on open: book field → default → `reader`. Persist mode on toggle via debounced `update_reading_state`.
   - 「问 Agent」: agent mode calls `fillInput` directly; reader collapsed path unchanged.
   - Do not remount on mode switch. Do not bind panel default/min size to collapse flags.

5. **Settings**
   - Appearance: default mode control. Writes `litera.defaultReaderMode` only.
   - i18n keys in `zh-CN.ts` and `en.ts` (parity test already exists).

6. **App-level tests**
   - Default open → reader.
   - Settings default agent + book without memory → agent.
   - Book with `lastReaderMode: "agent"` wins over default reader.
   - Changing default does not restyle a book that already has memory (assert no `update_reading_state` mode write on default change).
   - Mode toggle does not remount reader (no second `openBook` / fileData effect). If that is hard to assert, assert `ReaderView` stays mounted (same test id) and chat input value survives.
   - Agent: collapse list, resize/collapse book; selection still fills chat when book is open.

## Validation

```bash
npx vitest run
cd src-tauri && cargo test
npx tsc --noEmit
```

Frontend lint if the project script exists (`npm test` / `npm run lint` — use package.json).

## Risky files

- `src/App.tsx` — layout root; easy to remount or fork a second ReaderView.
- `src/components/chat/ChatPanel.tsx` — keep `useAgentBridge` here.
- `src-tauri/src/library.rs` — `deny_unknown_fields` + `update_reading_state` contract.

## Rollback points

- After step 2: backend-only field is inert if UI is reverted.
- After step 4: if the grid remounts in practice, stop and fix the shell before adding more chrome.

## Follow-up before start

- `implement.jsonl` / `check.jsonl` curated.
- Do not start until the user approves this planning summary.
