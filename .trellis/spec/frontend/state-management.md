# State Management

> How state is managed in the Litera frontend. There is **no global state library** (no Redux, Zustand, Jotai, or React Context). All state is local `useState` in components, passed down via props, with Tauri events as the cross-layer communication channel.

---

## Overview

Litera's frontend is small enough that local component state + props drilling is sufficient. The only "global-ish" state lives in `App.tsx` and is passed to child components via props. Cross-component communication that doesn't fit props (streaming agent responses, session lifecycle) flows through Tauri events (`@tauri-apps/api/event`).

Reference files:
- `src/App.tsx` — root state: view mode, file data, progress, style state, refs to child components
- `src/components/ChatPanel.tsx` — local message/session state, Tauri event subscriptions
- `src/components/ReaderView.tsx` — local selection state, ref-stable callbacks

---

## State Categories

### 1. Root component state (App.tsx)

```typescript
// src/App.tsx
const [view, setView] = useState<"library" | "reader">("library");
const [fileData, setFileData] = useState<FileData | null>(null);
const [currentBook, setCurrentBook] = useState<BookRecord | null>(null);
const [progress, setProgress] = useState<{ index: number; fraction: number; label?: string }>({ ... });
const [styleState, setStyleState] = useState<ReaderStyleState>({ fontSize: 16, fontFamily: "serif", theme: "light" });
const [toc, setToc] = useState<TocItem[]>([]);
```

These are the closest thing to "global state". They're passed down as props:
- `fileData` → `ReaderView` (triggers book open effect)
- `onRelocate`, `onSelectionCapture`, `onBookReady` → `ReaderView` (callbacks)
- `currentChapterIndex`, `bookId` → `ChatPanel` (context for prompts)

### 2. Local component state

Each component owns its own UI state:
- `ChatPanel`: `messages`, `input`, `isStreaming`, `error`, `sessions`, `currentSessionId`, `showSessionList`
- `LibraryView`: `books`, `search`, `importing`
- `ReaderView`: `selectionPos` (transient selection button position)

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

Streaming agent responses and session lifecycle flow through Tauri events, not props:

```typescript
// src/components/ChatPanel.tsx
await listen<{ delta: string }>("agent_text_delta", (event) => {
  setMessages((prev) => { /* append delta to last assistant message */ });
});
```

---

## When to Use Global State

**Currently: never.** The app is small enough that props drilling from `App.tsx` covers all cases. If the component tree grows deeper or multiple distant components need the same state, consider:

1. **React Context** for truly shared state (e.g. current book, style settings).
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

Tauri event (agent_text_delta, session_switched, etc.)
  → ChatPanel listen() handler → local setState
  → React re-render
```

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

**Wrong**: including `bookId` in the `listen()` effect dependency array.

**Correct**: subscribe once (`[]` deps), use `bookIdRef` inside listeners. Reset session state in a separate effect keyed on `bookId`:
```typescript
useEffect(() => {
  setSessions([]); setCurrentSessionId(null); setMessages([]);
  if (bookId) void invoke("list_sessions", { bookId }).catch(() => {});
}, [bookId]);
```
