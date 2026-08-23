# Design: Paseo-style chat outline rail

## Boundaries

- Frontend only. `ChatPanel` already owns user-message refs, scroll follow, and jump-to-message.
- Replace overlay `UserMessageToc` with a rail. Do not add backend prompt-index APIs.
- `variant="docked"` never mounts the rail or the old header `List` button.

## Layout

```
ChatPanel (workspace)
├── SessionList rail (existing, optional)
└── message column (relative)
    ├── header (no TOC button)
    ├── scroll container
    │   └── ChatOutlineRail  // absolute, left edge, pointer-events on ticks only
    └── ChatInput
```

Rail is `position: absolute; left: 0; top ~10%; bottom ~10%; width ~36px; z-index` above messages, below dialogs. It must not cover `ChatInput`.

Docked `ChatPanel` keeps the same message column without the rail or header TOC control.

## Data

Derive items in `ChatPanel` as today:

```ts
state.messages.flatMap((message, index) =>
  message.role === "user"
    ? [{ messageIndex: index, preview: userMessagePreview(message.content) }]
    : [],
)
```

Mount rail iff `variant === "workspace" && items.length >= 2`.

Active index continues to come from `updateActiveUserMessage()` on scroll (reading top = container top + inset). Rail highlights `activeMessageIndex`. Jump reuses `handleMessageTocGoTo` (suspend bottom follow, `scrollIntoView`, settle on `scrollend` / timeout). After jump, do not unmount the rail.

## Rail interaction

New module beside the component (keep logic out of `ChatPanel`):

| Piece | Behavior |
|---|---|
| Hover intent | Copy Paseo: 150ms delay on first rail entry; after activation, moving between ticks is immediate; ~4px horizontal pointer travel can also activate (crossing vs intending). Leave clears preview. |
| Magnification | Dock-style falloff around the attention index (hovered or focused). Pills grow rightward from a shared left edge. Slots do not move. Honor `prefers-reduced-motion`: magnification = 0. |
| Preview | One floating 2-line preview to the right of the attended tick. `pointer-events: none`. 1px border + surface token, **no** `shadow-*`. |
| Keyboard | Each tick is a focusable control (`tab` / `aria-current="location"` on the active one). Focus uses the same preview as hover. Enter/Space jumps. |

Do not put hover state on a nested button that resizes under the pointer; hover lives on the slot, press on the inner control (Paseo `docs/hover.md` pattern).

## Chrome / i18n

- Remove `List` TOC button from both header variants.
- Drop `chat.messageTocClose` if nothing else uses it.
- Keep `chat.messageToc` as the rail's accessible name.
- Keep `chat.messageTocItem` for tick labels (`number` + `preview`).
- Do not add a settings flag.

## Compatibility

- Session rail open/closed: outline stays on the **message** column left, not under the session list.
- Switching session/book: existing `ChatPanel` effects already reset jump timers and active index; also clear rail hover/focus by remounting on `sessionId` / `bookId` or passing a key.
- Overlay `UserMessageToc` tests that click「对话目录」/ Escape / complementary close must be rewritten for the rail; docked tests must assert the control is absent.

## Trade-offs

- No 918px hide gate: rail can overlay bubbles when the book pane is wide. Accepted so Agent+book still gets navigation.
- No pin/expanded list: scanning is slide-along-the-rail, like Paseo, not ChatGPT's full label column.
- Not a 1:1 port of Paseo RN/unistyles code; reimplement with React DOM + Tailwind tokens already used by chat chrome.
