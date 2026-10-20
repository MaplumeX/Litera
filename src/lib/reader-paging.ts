export type HitZone = "left" | "right" | "middle";

export interface WheelPagingState {
  accumulated: number;
  lastTime: number;
  flipped: boolean;
}

const WHEEL_THRESHOLD = 30;
const WHEEL_IDLE_RESET_MS = 200;
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 800;

function normalizeWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * WHEEL_PAGE_PX;
  return delta;
}

export function pageLocalX(clientX: number, pageWidth: number): number {
  if (pageWidth <= 0) return 0;
  return ((clientX % pageWidth) + pageWidth) % pageWidth;
}

/** Visible-spread width of a chapter document. Root `clientWidth` / `innerWidth` are the iframe viewport (the whole strip). */
export function pageWidthOf(doc: Document): number {
  return doc.documentElement?.getBoundingClientRect().width ?? 0;
}

export function hitFromClientX(x: number, width: number): HitZone {
  if (width <= 0) return "middle";
  if (x < width / 3) return "left";
  if (x > (width * 2) / 3) return "right";
  return "middle";
}

export function shouldIgnorePagingTarget(el: EventTarget | null): boolean {
  if (el == null || typeof el !== "object") return false;
  const node = el as {
    nodeType?: number;
    parentElement?: EventTarget | null;
    tagName?: string;
    closest?: (selector: string) => EventTarget | null;
    contentEditable?: string;
    isContentEditable?: boolean;
  };
  // Iframe documents have a different Element realm; avoid instanceof.
  if (node.nodeType === 3) return shouldIgnorePagingTarget(node.parentElement ?? null);
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (node.isContentEditable || node.contentEditable === "true") return true;
  // Sliders (the progress bar) own their arrow keys.
  return Boolean(node.closest?.('[role="dialog"], [role="slider"]'));
}

export function shouldIgnoreSpaceTarget(el: EventTarget | null): boolean {
  if (shouldIgnorePagingTarget(el)) return true;
  if (el == null || typeof el !== "object") return false;
  const node = el as {
    nodeType?: number;
    parentElement?: EventTarget | null;
    tagName?: string;
    closest?: (selector: string) => EventTarget | null;
  };
  if (node.nodeType === 3) return shouldIgnoreSpaceTarget(node.parentElement ?? null);
  if (node.tagName === "BUTTON") return true;
  return Boolean(node.closest?.('button, [role="button"], [role="slider"], input[type="range"]'));
}

/** What a key press does to the Book pane. */
export type ReaderKeyAction =
  | "prev"
  | "next"
  | "left"
  | "right"
  | "lineUp"
  | "lineDown"
  | "start"
  | "end"
  | "back"
  | "forward"
  | "ttsToggle";

export interface ReaderKeyInput {
  key: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EventTarget | null;
}

export interface ReaderKeyContext {
  /** Scrolled flow: ↑/↓ scroll a little instead of turning a page. */
  scrolled: boolean;
  /** Read-aloud is playing or paused, so Space toggles it instead of paging. */
  ttsActive: boolean;
}

/**
 * Map a key press to a reader action, or null when the key is not ours
 * (typing into a field, a slider owning its arrows, a modifier shortcut).
 * ←/→ follow the page direction; PageUp/PageDown and Space follow reading order.
 */
export function readerKeyAction(
  input: ReaderKeyInput,
  context: ReaderKeyContext,
): ReaderKeyAction | null {
  if (input.ctrlKey || input.metaKey) return null;
  const isSpace = input.key === " " || input.code === "Space";
  if (isSpace) {
    if (input.altKey || shouldIgnoreSpaceTarget(input.target ?? null)) return null;
    if (context.ttsActive && !input.shiftKey) return "ttsToggle";
    return input.shiftKey ? "prev" : "next";
  }
  if (shouldIgnorePagingTarget(input.target ?? null)) return null;
  if (input.altKey) {
    if (input.shiftKey) return null;
    if (input.key === "ArrowLeft") return "back";
    if (input.key === "ArrowRight") return "forward";
    return null;
  }
  if (input.shiftKey) return null;
  switch (input.key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return context.scrolled ? "lineUp" : "prev";
    case "ArrowDown":
      return context.scrolled ? "lineDown" : "next";
    case "PageUp":
      return "prev";
    case "PageDown":
      return "next";
    case "Home":
      return "start";
    case "End":
      return "end";
    default:
      return null;
  }
}

export type VolumeKeyDirection = "up" | "down";

export interface VolumeKeyContext {
  /** The reader turned on volume-key paging in Settings. */
  enabled: boolean;
  /** The Reader page is showing; elsewhere the keys change the volume. */
  readerActive: boolean;
}

/** Volume down turns forward and volume up back, as in other Android readers. */
export function volumeKeyAction(
  direction: VolumeKeyDirection,
  context: VolumeKeyContext,
): "prev" | "next" | null {
  if (!context.enabled || !context.readerActive) return null;
  return direction === "down" ? "next" : "prev";
}

/** Actions that also scroll whatever scroll area the reader last clicked. */
const SCROLL_KEY_ACTIONS: ReadonlySet<ReaderKeyAction> = new Set([
  "prev",
  "next",
  "lineUp",
  "lineDown",
  "start",
  "end",
]);

export function isScrollKeyAction(action: ReaderKeyAction): boolean {
  return SCROLL_KEY_ACTIONS.has(action);
}

/**
 * The scrollable element (other than the Book) a pointer press landed in,
 * if any. Chromium keyboard-scrolls the last clicked scroll area even
 * without focus, so a later ↓ / Space there belongs to it, not the Book.
 */
export function scrollAreaAt(target: EventTarget | null, book: Element): Element | null {
  let node = target instanceof Element ? target : null;
  while (node && node !== node.ownerDocument.body) {
    if (node === book) return null;
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Ctrl/⌘+F, the find-in-book shortcut. */
export function isFindShortcut(input: ReaderKeyInput): boolean {
  return (
    (input.ctrlKey || input.metaKey) === true &&
    !input.altKey &&
    !input.shiftKey &&
    input.key.toLowerCase() === "f"
  );
}

/** Jumps closer together than this (progress-bar arrow keys) are one history entry. */
export const SEEK_BURST_MS = 1500;

export function isSeekBurst(lastSeekAt: number, now: number): boolean {
  return lastSeekAt > 0 && now - lastSeekAt < SEEK_BURST_MS;
}

/** Screens read past a jump before its back / forward controls step aside. */
export const READ_ON_SCREENS = 3;

/** Where the Book shows: section index and offset in screens (pages, or viewport heights when scrolled). */
export interface ReadingMark {
  index: number;
  screen: number;
}

/** Screens read between two marks; moving into another section counts as one. */
export function screensBetween(from: ReadingMark, to: ReadingMark): number {
  if (from.index !== to.index) return 1;
  return Math.abs(to.screen - from.screen);
}

/**
 * Scrolled flow renders one section at a time: a wheel push past either end
 * of the section moves to the neighbouring one. Returns the direction to
 * cross in, or 0 when the wheel should just scroll natively.
 */
export function scrolledBoundaryDirection(
  delta: number,
  position: { start: number; size: number; viewSize: number },
): -1 | 0 | 1 {
  const { start, size, viewSize } = position;
  if (delta > 0 && viewSize - (start + size) <= 2) return 1;
  if (delta < 0 && start <= 0) return -1;
  return 0;
}

const CLICK_SLOP_PX = 5;

function hasHrefTarget(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  const node = target as {
    nodeType?: number;
    parentElement?: EventTarget | null;
    closest?: (selector: string) => unknown;
  };
  if (node.nodeType === 3) return hasHrefTarget(node.parentElement ?? null);
  return Boolean(node.closest?.("a[href]"));
}

export interface PointerPagingOptions {
  /** Skip left/right paging for this gesture (e.g. a painted highlight). */
  shouldIgnore?: (event: PointerEvent) => boolean;
  /** Fired on an idle click that did not hit shouldIgnore (blank tap). */
  onIdlePointerUp?: (event: PointerEvent) => void;
  /** A blank tap in the middle third (the mobile shell toggles its chrome). */
  onMiddleTap?: (event: PointerEvent) => void;
}

export function bindPointerPaging(
  target: EventTarget,
  getX: (event: PointerEvent) => number,
  getWidth: () => number,
  getSelection: () => Selection | null,
  pageLeft: () => void,
  pageRight: () => void,
  options?: PointerPagingOptions,
): () => void {
  let startX = 0;
  let startY = 0;
  let startScreenX = 0;
  let startScreenY = 0;
  let armed = false;
  let hadSelection = false;

  const onDown = (event: Event) => {
    const pe = event as PointerEvent;
    if (pe.button !== 0) return;
    startX = pe.clientX;
    startY = pe.clientY;
    startScreenX = pe.screenX;
    startScreenY = pe.screenY;
    armed = true;
    const sel = getSelection();
    hadSelection = Boolean(sel && !sel.isCollapsed);
  };

  const onUp = (event: Event) => {
    if (!armed) return;
    armed = false;
    const pe = event as PointerEvent;
    if (pe.button !== 0) return;
    if (Math.hypot(pe.clientX - startX, pe.clientY - startY) >= CLICK_SLOP_PX) return;
    // A touch drag scrolls the chapter's iframe along with the finger, so in
    // the chapter's own coordinates a swipe barely moves; on screen it does.
    if (Math.hypot(pe.screenX - startScreenX, pe.screenY - startScreenY) >= CLICK_SLOP_PX) return;
    if (hasHrefTarget(pe.target)) return;
    // pointerdown typically collapses an existing range; don't page on that click.
    if (hadSelection) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return;
    if (options?.shouldIgnore?.(pe)) return;
    options?.onIdlePointerUp?.(pe);
    const zone = hitFromClientX(getX(pe), getWidth());
    if (zone === "left") pageLeft();
    else if (zone === "right") pageRight();
    else options?.onMiddleTap?.(pe);
  };

  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  return () => {
    target.removeEventListener("pointerdown", onDown);
    target.removeEventListener("pointerup", onUp);
  };
}

/**
 * Keeps a tap's touch events away from foliate's paginator, which snaps to
 * a page on every `touchend`. A tap already turns the page through
 * `bindPointerPaging`; when that turn crosses into the next section, the
 * snap starts a second section load that replaces the first one's iframe,
 * the first load never settles, and the paginator's page-turn lock stays
 * held, so no later tap or key turns a page. Until a touch moves past the
 * click slop (or a second finger lands) its `touchmove`s and its `touchend`
 * stop here, in the capture phase, before the paginator's listeners; a real
 * drag passes through whole. `active` is false in scrolled flow, where the
 * paginator neither snaps nor cancels moves and the browser scrolls.
 */
export function bindTapTouchGuard(target: EventTarget, active: () => boolean): () => void {
  let start: { x: number; y: number } | null = null;
  let dragging = false;

  const onStart = (event: Event) => {
    const touches = (event as TouchEvent).touches;
    if (touches.length > 1) {
      dragging = true;
      return;
    }
    const touch = touches[0];
    start = touch ? { x: touch.screenX, y: touch.screenY } : null;
    dragging = false;
  };
  const onMove = (event: Event) => {
    if (dragging || !start || !active()) return;
    const te = event as TouchEvent;
    const touch = te.touches[0];
    if (
      te.touches.length > 1 ||
      !touch ||
      Math.hypot(touch.screenX - start.x, touch.screenY - start.y) >= CLICK_SLOP_PX
    ) {
      dragging = true;
      return;
    }
    // The paginator would have cancelled it too; the browser must not take
    // the gesture over as a scroll.
    if (te.cancelable) te.preventDefault();
    event.stopPropagation();
  };
  const onEnd = (event: Event) => {
    if (!dragging && start && active()) event.stopPropagation();
    if ((event as TouchEvent).touches.length === 0) {
      start = null;
      dragging = false;
    }
  };

  const capture = { capture: true };
  const captureActive = { capture: true, passive: false };
  target.addEventListener("touchstart", onStart, capture);
  target.addEventListener("touchmove", onMove, captureActive);
  target.addEventListener("touchend", onEnd, capture);
  target.addEventListener("touchcancel", onEnd, capture);
  return () => {
    target.removeEventListener("touchstart", onStart, capture);
    target.removeEventListener("touchmove", onMove, captureActive);
    target.removeEventListener("touchend", onEnd, capture);
    target.removeEventListener("touchcancel", onEnd, capture);
  };
}

export function consumeWheelDelta(
  state: WheelPagingState,
  delta: number,
  now: number = Date.now(),
  deltaMode: number = 0,
): { turn: -1 | 1 | 0; state: WheelPagingState } {
  let accumulated = state.accumulated;
  let flipped = state.flipped;
  if (now - state.lastTime > WHEEL_IDLE_RESET_MS) {
    accumulated = 0;
    flipped = false;
  }

  if (flipped) {
    return { turn: 0, state: { accumulated: 0, lastTime: now, flipped: true } };
  }

  accumulated += normalizeWheelDelta(delta, deltaMode);
  if (Math.abs(accumulated) < WHEEL_THRESHOLD) {
    return { turn: 0, state: { accumulated, lastTime: now, flipped: false } };
  }

  const turn: -1 | 1 = accumulated > 0 ? 1 : -1;
  return { turn, state: { accumulated: 0, lastTime: now, flipped: true } };
}
