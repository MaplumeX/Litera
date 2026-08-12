# Hook Guidelines

> Custom hook patterns used in the Litera frontend. The project has no dedicated hooks directory — hooks are defined inline in components or as small helpers in `App.tsx`.

---

## Overview

Litera's frontend uses React 19 hooks directly. There is no `src/hooks/` directory and no shared custom hooks file. Hook patterns are minimal and purpose-driven: one debounced-callback helper and heavy use of refs for stable identities.

Reference files:
- `src/App.tsx` — `useDebouncedCallback`
- `src/components/ReaderView.tsx` — ref-stable callbacks, `useImperativeHandle`
- `src/components/ChatPanel.tsx` — `listen()` event subscription, auto-scroll
- `src/components/LibraryView.tsx` — data fetch on mount

---

## Custom Hook Patterns

### Pattern: `useDebouncedCallback` for persisted state

Reading position and settings changes are debounced before invoking the Rust backend. The helper lives in `App.tsx`, not a shared file.

```typescript
// src/App.tsx
function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
): T {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;  // keep latest fn without re-creating the debounced wrapper
  return useCallback(
    (...args: Parameters<T>) => {
      if (ref.current) clearTimeout(ref.current);
      ref.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  ) as T;
}
```

**Usage**: debounced `update_reading_state` calls on relocate and style change (500ms delay).

**Key detail**: `fnRef.current = fn` updates on every render so the latest callback runs, but the returned function is stable (only depends on `delay`). This prevents effect re-runs when the debounced callback is in a dependency array.

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

`ChatPanel` subscribes to multiple Tauri events in a single `useEffect`. All unlisten functions are collected and cleaned up on unmount.

```typescript
// src/components/ChatPanel.tsx
useEffect(() => {
  const unlisteners: UnlistenFn[] = [];
  (async () => {
    unlisteners.push(await listen<{ delta: string }>("agent_text_delta", (event) => { ... }));
    unlisteners.push(await listen("agent_end", () => { ... }));
    // ... more listeners
  })();
  return () => { unlisteners.forEach((fn) => fn()); };
}, []);
```

**Key details**:
- Empty dependency array `[]` — subscribe once on mount, never re-subscribe.
- `async` IIFE inside the effect because `listen()` is async.
- `bookIdRef` (ref) used inside listeners to read the latest `bookId` without re-subscribing.

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

- **Custom hooks**: `use*` prefix (only `useDebouncedCallback` exists as a standalone hook).
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

**Wrong**: putting `bookId` or callback props in the `listen()` effect's dependency array. This re-subscribes on every change, causing duplicate events.

**Correct**: use refs for values that change, keep the effect deps `[]`.

### Calling foliate.js methods before init() completes

`view.init({})` internally calls `next()`. Calling `goToFraction()` concurrently causes navigation conflicts. Always `await view.open()` → `await view.init({})` → `await view.goToFraction()` in sequence. See `src/components/ReaderView.tsx`.