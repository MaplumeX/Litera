# Hook Guidelines

> Custom hook patterns used in the Litera frontend. Small reusable lifecycle helpers live under `src/lib/`.

---

## Overview

Litera's frontend uses React 19 hooks directly. Hook patterns are minimal and purpose-driven: one tested debounced-callback controller/hook and heavy use of refs for stable identities.

Reference files:
- `src/lib/debounced-callback.ts`, `src/lib/use-debounced-callback.ts` — controller and React lifecycle wrapper
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

Book/session/prompt state must be recoverable from the snapshot and persisted session history. Do not rely on `agent_ready`/`book_ready` UI timing or add multiple per-event listeners again.

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

### Calling foliate.js methods before init() completes

`view.init({})` internally calls `next()`. Calling `goToFraction()` concurrently causes navigation conflicts. Always `await view.open()` → `await view.init({})` → `await view.goToFraction()` in sequence. See `src/components/ReaderView.tsx`.
