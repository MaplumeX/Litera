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
