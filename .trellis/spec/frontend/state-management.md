# State Management

> How state is managed in the Litera frontend. There is **no global state library** (no Redux, Zustand, Jotai, or React Context). All state is local `useState` in components, passed down via props, with Tauri events as the cross-layer communication channel.

---

## Overview

Litera's frontend is small enough that local component state + props drilling is sufficient. The only "global-ish" state lives in `App.tsx` and is passed to child components via props. Cross-component communication that doesn't fit props (streaming agent responses, session lifecycle) flows through Tauri events (`@tauri-apps/api/event`).

Reference files:
- `src/App.tsx` — root state: view mode, file data, progress, style state, refs to child components
- `src/lib/agent-reducer.ts` — pure Agent state projection and correlation filtering
- `src/lib/use-agent-bridge.ts` — Tauri commands, listener, snapshot hydration
- `src/components/chat/ChatPanel.tsx` — transient input/overlay state plus reducer-rendered Agent state
- `src/components/ReaderView.tsx` — local selection state, ref-stable callbacks

---

## State Categories

### 1. Root component state (App.tsx)

```typescript
// src/App.tsx
const [view, setView] = useState<"library" | "reader">("library");
const [settingsOpen, setSettingsOpen] = useState(false);
const [fileData, setFileData] = useState<FileData | null>(null);
const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({ ... });
const styleState = normalizeSettings(currentBook?.settings, preferences);
const [toc, setToc] = useState<TocItem[]>([]);
const [chatCollapsed, setChatCollapsed] = useState(true);
const [tocVisible, setTocVisible] = useState(false);
```

These are the closest thing to "global state". They're passed down as props:
- `fileData` → `ReaderView` (triggers book open effect)
- `onRelocate`, `onSelectionCapture`, `onBookReady` → `ReaderView` (callbacks)
- `currentChapterIndex`, `bookId` → `ChatPanel` (context for prompts)

`progress` is relocate state, not reader chrome. Do not delete it when removing a progress bar: `progress.index` is `ChatPanel`'s `currentChapterIndex`, and `fraction` is persisted as `lastFraction`. Visible percent belongs on `BookCard`.

### 2. Local component state

Each component owns its own UI state:
- `ChatPanel`: transient `input`, `pendingSelection`, `submitting`, `invokeError`, `showSessionList`, and `showConfig` (LLM settings dialog only); Agent messages/sessions/status live in `AgentState`
- `LibraryView`: `books`, `search`, `importing`, selection-mode ids, overwrite/delete dialog state, import banners. Selection mode is local UI state and is not persisted. `list_books` already returns recency order — do not re-sort in React.
- OS-open notices / overwrite confirm live on `App`'s `useBookImport`, because `LibraryView` unmounts in the reader. Picker / drag-drop keep a second `useBookImport` on `LibraryView` and still do not auto-open.
- `ReaderView`: `selectionPos` (transient selection button position)

`App` `settingsOpen` owns `SettingsDialog` (library gear + reader Aa). `view` does not become `"settings"`; the library/reader tree stays mounted under the dialog. Do not lift ChatPanel LLM settings into that dialog.

Reader chrome flags (`tocVisible`, `chatCollapsed`) live only in `App` `useState`. They survive back-to-library and book switches in the same process. `handleBackToLibrary` must not reset them. Do not write them to `save_preferences`. Restart returns to TOC closed + chat collapsed. Clear `toc` data when leaving a book; only the open/closed flags persist in memory.

### 3. Ref state (non-rendering)

Values that should NOT trigger re-renders but need to be read by effects or event handlers:

```typescript
// src/App.tsx
const styleStateRef = useRef(styleState);
styleStateRef.current = styleState;  // latest style state for handleBookReady

// src/components/ChatPanel.tsx
const bookIdRef = useRef(bookId);
bookIdRef.current = bookId;  // latest bookId inside event listeners
```

### 4. Server state (Tauri backend)

Data fetched via `invoke()` is stored in local state. There is no React Query / SWR / cache layer.

```typescript
// src/components/LibraryView.tsx
const [books, setBooks] = useState<BookRecord[]>([]);
const refreshBooks = useCallback(async () => {
  const list = await invoke<BookRecord[]>("list_books");
  setBooks(list);
}, []);
```

### 5. Event-driven state (Tauri events)

Streaming Agent responses and session lifecycle flow through the single versioned event channel:

```typescript
await listen<AgentEvent>("agent_event", (event) => {
  dispatch({ type: "event", event: event.payload });
});
```

`agentReducer` accepts only increasing global versions and non-regressing generations. Book, session, prompt, session-list request, and tool-call changes require their matching correlation. An irrelevant old event may advance the global version cursor, but it cannot modify current operation content.

#### Optimistic session creation (session_created)

The sidecar's `SessionManager` does **not** persist an empty session to disk — it only writes the file once an assistant message exists (pi design to avoid empty-file buildup). This means `listSessions()` called right after `session_created` returns a list that **excludes** the just-created session.

Therefore the reducer's `session_created` case must **optimistically insert** a `AgentSessionSummary` (id from event, title `t("chat.newSessionTitle")` at event time, current timestamps) into `state.sessions` via a dedupe-by-id `upsertSession` helper. Sidecar `deriveTitle` still falls back to the Chinese `"新会话"` when there is no custom name and no first message (sidecar is outside UI i18n). After the first message, `listSessions()` replaces the optimistic row with the derived title. The `useAgentBridge` listener must **not** call `listSessions()` on `session_created` — that would overwrite the optimistic entry with a disk list that lacks it. The first real message persists the session; the subsequent `prompt_end` → `listSessions()` refresh replaces the optimistic entry with real disk data (same id, no duplicate).

`ChatPanel` "新建会话" stays inside the overlay session list (no header shortcut). After click: close the overlay and focus the input. If `state.sessionId` is set and `state.messages` is empty, do **not** invoke `new_session` — reuse that empty session. EmptyState subtitle when `bookReady` is 「选中段落，或直接提问。」; only the not-ready state may say 「打开一本书」.

---

### 6. Locale (module store, not Context)

UI language is **not** App props and **not** `preferences.json`. `src/lib/i18n.ts` holds the active locale; `useT()` subscribes with `useSyncExternalStore`. Persistence is `localStorage["litera.locale"]`. See [UI i18n](./i18n.md).

Do not introduce React Context for translations.

## When to Use Global State

**Currently: never, except the i18n module store above.** The app is small enough that props drilling from `App.tsx` covers other cases. If the component tree grows deeper or multiple distant components need the same state, consider:

1. **A module store + `useSyncExternalStore`** (same shape as locale) before adding Context.
2. **Do not introduce Redux/Zustand** unless there are 3+ independent state slices consumed by unrelated components.

For now, the ref-stable callback pattern (see `hook-guidelines.md`) handles the main pain point (callback identity changes causing effect re-runs).

---

## Persisted State (Cross-Session)

Reading position and settings persist via the Rust backend, not frontend state:

```typescript
// src/App.tsx — debounced persistence
const persistFraction = useDebouncedCallback(
  (bookId, fraction) => invoke("update_reading_state", { bookId, lastFraction: fraction }),
  500,
  reportPersistenceError,
);
```

**Pattern**: state change → local state update (immediate UI) → debounced persistence. Timer-triggered failures set a visible inline alert. Return-to-library, book switching, and close request call `flush()` and wait for active writes; a failed navigation flush keeps the reader open. Hook cleanup calls `cancel()` so React StrictMode/unmount cannot replay a stale timer.

Reader chrome title comes from `get_book_open_context().title`, not `name` (`name` stays `"book.epub"` for `File()`). Do not construct a `BookRecord` with an empty `title` after open.

`lastOpenedAt` is written by Rust after a successful `open_book_bytes`, not by the frontend debounce path.

---

## State Flow Diagram (Mental Model)

```
User action (click, select, type)
  → local setState (immediate render)
  → callback prop → parent setState (if cross-component)
  → debounced invoke() (background persistence with visible errors)

Navigation / close
  → flush pending fraction + settings
  → await active backend transactions
  → change view / destroy window only after success (close has a bounded timeout)

Tauri event (single agent_event union)
  → useAgentBridge → pure reducer correlation/version gate
  → React re-render
```

The Agent subsystem is the exception to the legacy multiple-event example: it uses a pure reducer plus `useAgentBridge`, listens only to `agent_event`, then reads `get_agent_snapshot`. The reducer accepts only increasing versions and checks book/session/prompt/request/toolCall correlation before changing UI state. Returning to the library invokes `close_book`, which aborts the active prompt and invalidates the book worker generation before the reader unmounts.

---

## Common Mistakes

### Storing derived state in separate useState

**Wrong**: `const [progressPct, setProgressPct] = useState(0)` and updating it alongside `progress`.

**Correct**: derive during render:
```typescript
const fractionPct = Math.round(progress.fraction * 100);
```

### Persisting on every keystroke / page turn

**Wrong**: calling `invoke("update_reading_state")` directly in `handleRelocate`.

**Correct**: debounce via `useDebouncedCallback` (500ms) so rapid page turns don't spam the backend.

### Re-subscribing to events when bookId changes

**Wrong**: including `bookId` in the Agent subscription effect or rebuilding multiple event listeners.

**Correct**: keep one listener, use `bookIdRef` inside callbacks, and reset book-scoped state through the reducer:
```typescript
useEffect(() => {
  dispatch({ type: "book_changed", bookId: bookId || null });
}, [bookId]);
```
