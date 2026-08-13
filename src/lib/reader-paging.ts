export type HitZone = "left" | "right" | "middle";

export interface WheelPagingState {
  accumulated: number;
  cooldownUntil: number;
}

const WHEEL_THRESHOLD = 80;
const WHEEL_COOLDOWN_MS = 280;

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
): { turn: -1 | 1 | 0; state: WheelPagingState } {
  if (now < state.cooldownUntil) {
    // Keep the cooldown alive while the same gesture still emits events
    // (macOS trackpad inertia lasts longer than a single short window).
    return {
      turn: 0,
      state: { accumulated: 0, cooldownUntil: now + WHEEL_COOLDOWN_MS },
    };
  }
  const accumulated = state.accumulated + delta;
  if (Math.abs(accumulated) < WHEEL_THRESHOLD) {
    return { turn: 0, state: { accumulated, cooldownUntil: 0 } };
  }
  const turn: -1 | 1 = accumulated > 0 ? 1 : -1;
  return {
    turn,
    state: { accumulated: 0, cooldownUntil: now + WHEEL_COOLDOWN_MS },
  };
}
