# Design: Agent reading mode

## Architecture

One persistent reader shell. Two visual layouts. No second `ReaderView` or `ChatPanel`.

```
header (shared): back · title · TOC · 标注 · Aa · [mode] · [reader: chat] [agent: sessions, book] · window buttons

reader mode grid:   [ book 1fr | chat 22% or 0 ]
agent mode grid:    [ chat (list 240px + messages) | book 38% or 0 ]
```

Mode only changes `grid-template-areas` / column sizes. `ReaderView` always lives in the `book` cell. `ChatPanel` always lives in the `chat` cell. Spec already forbids remounting these to toggle chat (`component-guidelines.md`).

```
          reader                          agent
     ┌──────────┬──────┐         ┌────┬────────┬──────┐
     │  book    │ chat │         │list│  chat  │ book │
     │          │overlay│         │    │        │      │
     └──────────┴──────┘         └────┴────────┴──────┘
```

In Agent mode the session list is a flex sibling **inside** `ChatPanel`, not an App-level third `Panel`. App only splits chat cell vs book cell. That keeps `useAgentBridge` inside `ChatPanel` and avoids lifting session APIs.

## Boundaries

| Piece | Owns |
| --- | --- |
| `App.tsx` | Mode resolution, grid shell, book cell (ReaderView + TOC/标注 overlays + Agent-mode progress), header toggles, persist per-book mode |
| `ChatPanel` | Messages, input, `useAgentBridge`, overlay list (reader) vs rail list (agent) |
| `SessionList` | List UI only; drop `absolute inset` overlay chrome when used as a rail |
| Settings → Appearance | App default mode control |
| Rust `library.rs` | `lastReaderMode` on `BookRecord` / `BookOpenContext` / `update_reading_state` |
| `localStorage` | `litera.defaultReaderMode`, Agent book width |

Do not change Agent runtime, session JSONL, or prompt contracts.

## Mode resolution

```
open book / load context
  if book.lastReaderMode in {reader, agent} → use it
  else if localStorage default in {reader, agent} → use it
  else → reader
```

Toolbar switch writes:

1. React state (immediate)
2. Debounced `update_reading_state({ lastReaderMode })` for the current book

Changing the Settings default only writes `localStorage`. It does not patch existing `BookRecord`s.

Factory / invalid default = `reader`.

## ChatPanel variants

`variant: "docked" | "workspace"` (or equivalent boolean).

- `docked` (reader): current header + overlay `SessionList`. Side chat can collapse to width 0; stay mounted and `hidden`.
- `workspace` (agent): left rail `SessionList` (~240px, not `absolute`), messages + input fill the rest. Header has a sessions toggle instead of the overlay button. Rail collapse is `w-0` / `hidden` overflow, not a full-panel overlay.

`SessionList` should accept a layout prop so one component serves both: overlay (existing close button + absolute fill) vs rail (no extra close-X required; parent toggle is enough). Do not duplicate list/rename/delete logic.

Keep one `ChatPanel` instance so input draft, `pendingSelection`, and streaming survive mode switch (R9, AC3).

## Book cell

Reuse the existing `ReaderView` plus TOC / 标注 overlays. They stay drawers over the book cell, never extra columns.

Progress scrubber:

- Reader mode: keep the full-width bar under the header.
- Agent mode: hide that full-width bar and render the same `ReaderProgressBar` **inside the book cell** so it does not stretch across the chat.

Typography / theme still apply through the existing `setStyles` path.

「问 Agent」:

- Agent + book visible → `fillInput` immediately (chat is visible).
- Reader + chat collapsed → existing pending-capture then expand.
- Agent + book collapsed → no selection (book is hidden). Book toggle just expands the book cell.

## Layout numbers and persistence

| Surface | Default | Persist |
| --- | --- | --- |
| Session rail | 240px, open | no (process-only collapse) |
| Agent book | 38%, min ~22%, open | width yes (`litera.agent-book-width`); collapse no |
| Reader chat | 22%, collapsed | width yes (existing layout id); collapse no |

Do not bind `defaultSize` / `minSize` to collapse flags (re-registers panels). Prefer a **unified CSS grid** (or equivalent non-remounting shell) over two alternate `Group` trees. Resize handles can follow the TOC pointer-drag pattern if `react-resizable-panels` cannot swap book/chat sides without remounting.

Reader mode book stays on the left; Agent mode book stays on the right. Same two children, different `grid-template-areas`.

## Settings UI

Appearance section: a two-option control (阅读 / Agent) using existing shadcn primitives. i18n both catalogs. `useT()` before any early return.

## Compatibility

- Old `library.json` without `lastReaderMode` loads. New optional field, no schema bump.
- Old `preferences.json` is untouched.
- Old builds that read a library file **with** `lastReaderMode` will hit `deny_unknown_fields` on `BookRecord` — same accepted trade-off as `lastOpenedAt` / `contentHash`.
- Existing side-chat behavior in reader mode stays.

## Rollback

Revert the UI shell and the optional Rust field. `lastReaderMode` on disk is ignored by older code only if that older code is this commit’s parent (unknown field fails). Ship the field as `skip_serializing_if = "Option::is_none"` so books never switched stay identical.

## Trade-offs

- Unified grid vs two `Group`s: grid is more code in `App.tsx` but is the only simple way to swap book side without remount.
- `lastReaderMode` in `library.json` vs `localStorage`: library wins so mode follows the book record, not the browser profile.
- Session rail inside `ChatPanel` vs App-level third column: keeps the bridge local; App does not grow another session-state owner.
