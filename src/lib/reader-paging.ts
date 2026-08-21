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
  return Boolean(node.closest?.('[role="dialog"]'));
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
  let armed = false;
  let hadSelection = false;

  const onDown = (event: Event) => {
    const pe = event as PointerEvent;
    if (pe.button !== 0) return;
    startX = pe.clientX;
    startY = pe.clientY;
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
  };

  target.addEventListener("pointerdown", onDown);
  target.addEventListener("pointerup", onUp);
  return () => {
    target.removeEventListener("pointerdown", onDown);
    target.removeEventListener("pointerup", onUp);
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
