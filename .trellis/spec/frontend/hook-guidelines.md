# Hook Guidelines

> Custom hook patterns used in the Litera frontend. Small reusable lifecycle helpers live under `src/lib/`.

---

## Overview

Litera's frontend uses React 19 hooks directly. Hook patterns are minimal and purpose-driven: one tested debounced-callback controller/hook and heavy use of refs for stable identities.

Reference files:
- `src/lib/debounced-callback.ts`, `src/lib/use-debounced-callback.ts` — controller and React lifecycle wrapper
- `src/lib/latest-serialized-task.ts` — latest-request-wins serialization for side-effecting async flows
- `src/components/ReaderView.tsx` — ref-stable callbacks, `useImperativeHandle`
- `src/lib/use-agent-bridge.ts`, `src/lib/agent-subscription.ts` — single Agent subscription, snapshot hydration
- `src/components/ChatPanel.tsx` — reducer-backed Agent UI, auto-scroll
- `src/components/LibraryView.tsx` — data fetch on mount

---

## Custom Hook Patterns

### Pattern: `useDebouncedCallback` for persisted state

Reading position and settings changes are debounced before invoking the Rust backend. The pure controller owns timer/queue behavior; the React hook owns latest-callback refs and unmount cleanup.

```typescript
const controller = useDebouncedCallback(callback, 500, reportError);
controller.schedule(bookId, value);
await controller.flush();
controller.cancel();
controller.pending;
```

**Usage**: debounced `update_reading_state` calls on relocate and style change (500ms delay), then `flush()` before book/view/close transitions.

**Key details**:

- `schedule()` keeps only the latest pending arguments.
- `flush()` executes pending work immediately and waits for already-running work; persistence errors reject to the caller.
- `cancel()` discards only pending work and is idempotent, including React StrictMode's setup/cleanup replay.
- Calls are serialized so a later invocation cannot race an earlier backend write.
- Callback/error refs update every render while the controller identity changes only with `delay`.

### Pattern: serialize latest-wins operations that have backend side effects

`open_book_bytes` both returns EPUB bytes and switches the sidecar's active
book. Therefore rapid A/B opens must not run as independent promises whose UI
results are merely filtered afterward. Use `createLatestSerializedTaskController`
to serialize the complete side-effecting operation and apply only the latest
request result:

```typescript
const request = controller.run(() => openBookBytes(bookId));
const result = await request.promise;
if (result.status === "completed") applyOpenedBook(result.value);
```

**Key details**:

- A running older request may finish, but the newer request runs immediately
  after it and becomes the final Reader and sidecar book.
- A queued request that is already stale is skipped before starting.
- Stale results and stale failures do not overwrite the latest UI state.
- Do not issue a compensating uncorrelated `close_book` for stale results; it
  could close the newer book. Serialization provides the ordering guarantee.

**Tests required**: hold A with a deferred promise, enqueue B, and assert B does
not start until A settles; A becomes stale, only B is applied, and an A failure
cannot replace B's visible result or error state.

### Pattern: ref-stable callbacks to avoid effect re-runs

When a component receives callback props that change identity on every parent render, store them in refs so effects depending on other values don't re-trigger.

```typescript
// src/components/ReaderView.tsx
const onRelocateRef = useRef(onRelocate);
const onBookReadyRef = useRef(onBookReady);
onRelocateRef.current = onRelocate;
onBookReadyRef.current = onBookReady;

// Effect depends on [fileData, initialFraction] only, NOT on callbacks
useEffect(() => {
  // ... open book ...
  onBookReadyRef.current?.(book?.toc ?? []);  // call latest without re-triggering
}, [fileData, initialFraction]);
```

**Why**: Parent components like `App` recreate `handleBookReady` on every render (it closes over `styleState`). Without refs, the file-open effect would re-run on every parent render, reopening the book repeatedly.

**Rule**: Any callback prop used in a `useEffect` that should only depend on data changes must be stored in a ref. Update the ref on every render (outside the effect).

### Pattern: `useImperativeHandle` for component APIs

`ReaderView` and `ChatPanel` expose imperative APIs to parents via `forwardRef` + `useImperativeHandle`. This is the idiomatic way to control foliate.js (a web component) and fill the chat input from outside.

```typescript
// src/components/ReaderView.tsx
export interface ReaderViewHandle {
  prev: () => void;
  next: () => void;
  goToFraction: (frac: number) => void;
  goToTocItem: (href: string) => void;
  setStyles: (css: string) => void;
  getToc: () => TocItem[];
}

useImperativeHandle(ref, () => ({ prev, next, goToFraction, goToTocItem, setStyles, getToc }), [
  prev, next, goToFraction, goToTocItem, setStyles, getToc,
]);
```

Parent usage:
```typescript
// src/App.tsx
const readerRef = useRef<ReaderViewHandle>(null);
readerRef.current?.setStyles(css);
readerRef.current?.goToTocItem(href);
```

### Pattern: OS-open wake-up then drain

`registerOpenPathsListener` (`src/lib/open-paths.ts`) listens for `open-paths-available`, then **drains** `take_pending_open_paths` in a serialized chain. Mount it from `App` via `useOpenPaths`, not `LibraryView` (the library unmounts in the reader).

```typescript
listen("open-paths-available", () => handler());
const paths = await invoke<string[]>("take_pending_open_paths");
```

**Key details**:

- Event payload is empty. Paths come only from take.
- After listen resolves, take once for the cold-start queue; later events take again.
- Disposed flag: if `listen()` resolves after cleanup, call unlisten immediately and do not take.
- Drain until take returns nothing. Dedup a path for 5s after a successful import so macOS argv + `RunEvent::Opened` do not overwrite the same file. Clear that entry when the batch has no success so cancel/fail can retry.
- Open only the last successful `bookId`. Picker / drag-drop keep a separate `useBookImport` and do not auto-open.
- Overwrite confirm must render in `App` so it still works on the reader view.

**Tests required**: cold-start take opens the last id; empty queue does not call `openBook`; cancelled overwrite still opens a later id; dispose-before-listen-resolve unlistens; same path within 5s is skipped.

### Pattern: Tauri event subscription with cleanup

The Agent bridge owns one `agent_event` listener. Registration and snapshot hydration are separated into `registerAgentSubscription` so late `listen()` resolution is testable.

```typescript
// src/lib/use-agent-bridge.ts
useEffect(() => {
  const subscription = registerAgentSubscription({
    listen: async (handler) => listen<AgentEvent>("agent_event", (event) => handler(event.payload)),
    getSnapshot: () => invoke<AgentSnapshot>("get_agent_snapshot"),
    onEvent: (event) => dispatch({ type: "event", event }),
    onSnapshot: (snapshot) => dispatch({ type: "hydrate", snapshot }),
    onError: reportError,
  });
  return () => subscription.dispose();
}, [stableCallbacks]);
```

**Key details**:
1. Register the single `agent_event` listener.
2. After registration resolves, call `get_agent_snapshot` and hydrate the reducer.
3. Keep a disposed flag. If the listener promise resolves after cleanup, immediately call the returned unlisten function.
4. Filter live events and snapshots by monotonic `version`, `generation`, and operation correlation in the pure reducer.
5. Use `bookIdRef` for current-book reads inside stable callbacks; change visible book state in a separate reducer action.
6. The `book_changed` effect must only `dispatch({ type: "book_changed", bookId })`; it must NOT issue `list_sessions` / `switch_session` / `agent_prompt` or any other sidecar command that depends on `currentBook`. The sidecar's `handleOpenBook` sets `currentBook` asynchronously (it only enters the child-writer queue before `open_book_bytes` returns), so a command sent from the `book_changed` effect can arrive while `currentBook` is still `null` or the previous book and hit `requireCurrentBook`'s `Command does not match the current book`. Session-list refresh, pending-session restore, and the first prompt must be driven by the `book_ready` event instead.
7. For snapshot hydration during sidecar restart/replay: when `onSnapshot` arrives with `status !== "bookReady"` but carries a `sessionId`, store it in a `pendingRestoreSessionIdRef` and consume it on the next `book_ready` event. Only `switchSession` immediately when `status === "bookReady"`.
8. Gate `prompt()` with a `statusRef` (latest `state.status`) so it rejects before invoking `agent_prompt` unless `status === "bookReady"`. This is the bridge-layer backstop behind `ChatPanel`'s `bookReady` send-enable check.

Book/session/prompt state must be recoverable from the snapshot and persisted session history. Do not add multiple per-event listeners, and do not infer readiness from React render timing — the protocol-level `book_ready` event is the only green light for `currentBook`-dependent commands.

### Pattern: data fetch on mount

```typescript
// src/components/LibraryView.tsx
const refreshBooks = useCallback(async () => {
  const list = await invoke<BookRecord[]>("list_books");
  setBooks(list);
}, []);

useEffect(() => { void refreshBooks(); }, [refreshBooks]);
```

**Rule**: `invoke<T>()` calls must be typed with the expected return type. Wrap in `try/catch` with `console.error` for error logging.

---

## Naming Conventions

- **Custom hooks**: `use*` prefix (`useDebouncedCallback`).
- **Refs for latest values**: `*Ref` suffix (`onRelocateRef`, `onBookReadyRef`, `styleStateRef`, `bookIdRef`).
- **Imperative handles**: `*Handle` type suffix (`ReaderViewHandle`, `ChatPanelHandle`).

---

## Common Mistakes

### Callback props in effect dependency arrays

**Wrong**:
```typescript
useEffect(() => {
  onBookReady?.(toc);
}, [fileData, onBookReady]);  // re-runs when parent recreates onBookReady
```

**Correct**: store in ref, call from effect, omit from deps:
```typescript
const onBookReadyRef = useRef(onBookReady);
onBookReadyRef.current = onBookReady;
useEffect(() => {
  onBookReadyRef.current?.(toc);
}, [fileData]);
```

### Re-subscribing to Tauri events on every render

**Wrong**: adding per-event Agent listeners or putting `bookId` itself in the subscription effect dependencies. This causes duplicate listeners during book switches.

**Correct**: use the single `registerAgentSubscription`, refs for changing values, and stable callback dependencies.

### Issuing currentBook-dependent commands from the `book_changed` effect

**Symptom**: opening or switching a book intermittently surfaces `Command does not match the current book` in the AI chat panel.

**Cause**: `open_book_bytes` only confirms the `OpenBook` command entered the sidecar child-writer queue before returning EPUB bytes; it does NOT confirm the sidecar's `SerialDispatcher` has consumed it and set `currentBook`. A `list_sessions` / `switch_session` / `agent_prompt` fired from the `book_changed` effect can arrive while the sidecar's `currentBook` is still `null` or the previous book, so `requireCurrentBook` rejects it.

**Wrong**:
```typescript
useEffect(() => {
  dispatch({ type: "book_changed", bookId });
  if (bookId) void listSessions();        // races sidecar's async OpenBook handling
}, [bookId]);
```

**Correct**: drive session-list refresh and session restore from the `book_ready` event; keep `book_changed` effect command-free.
```typescript
useEffect(() => {
  dispatch({ type: "book_changed", bookId: bookId || null });
  pendingRestoreSessionIdRef.current = null;
}, [bookId]);
// onEvent: event.type === "book_ready" → listSessions() + consume pendingRestoreSessionIdRef
```

### Calling foliate.js methods before init() completes

`view.init({})` internally calls `next()`. Calling `goToFraction()` concurrently causes navigation conflicts. Always `await view.open()` → `await view.init({})` → `await view.goToFraction()` in sequence. See `src/components/ReaderView.tsx`.
