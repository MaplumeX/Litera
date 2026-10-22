import { useCallback, useRef, type RefCallback, type RefObject } from "react";

/** The way a panel leaves: a bottom sheet goes down, the drawer goes left. */
export type DismissDirection = "down" | "left";

/** Movement before a touch counts as a drag rather than a tap. */
const SLOP_PX = 8;
/** Let go past this share of the panel and it closes... */
const DISMISS_FRACTION = 0.3;
/** ...or flicked at least this fast (px/ms) toward the edge. */
const FLING_VELOCITY = 0.5;

/** Whether a drag let go at `offset` (px toward the edge) closes the panel. */
export function shouldDismiss(offset: number, velocity: number, size: number): boolean {
  if (offset <= 0) return false;
  return offset >= size * DISMISS_FRACTION || velocity >= FLING_VELOCITY;
}

/**
 * Whether a touch on `target` may start dragging the panel: not on a text
 * field or anything that handles its own touches (`touch-action: none`, as
 * sliders and drag handles set), and, for a sheet, only with whatever it
 * scrolls already at the top, so the first swipe down scrolls it back.
 */
export function canStartDrag(target: Element, panel: HTMLElement, direction: DismissDirection): boolean {
  for (let node: Element | null = target; node && node !== panel.parentElement; node = node.parentElement) {
    if (node.matches("input, textarea, select, [contenteditable='true']")) return false;
    if (getComputedStyle(node).touchAction === "none") return false;
    if (direction === "down" && node.scrollTop > 0) return false;
    if (node === panel) break;
  }
  return true;
}

const SETTLE = "var(--motion-feedback) var(--ease-emphasized-decelerate)";

/**
 * Drag a modal panel toward its edge to close it, as native sheets and
 * drawers do. The panel follows the finger (and its scrim fades with it);
 * let go far or fast enough and `onDismiss` runs, else it springs back.
 * Closing leaves the panel where the finger left it, so its exit animation
 * (`to` keyframes only) carries on from there.
 *
 * Returns a ref for the panel. Touch events, not pointer events: the sheet
 * scrolls, and only a non-passive touchmove can keep the browser from
 * taking the gesture over.
 */
export function useSwipeDismiss<T extends HTMLElement>({
  direction,
  onDismiss,
  scrimRef,
}: {
  direction: DismissDirection;
  onDismiss: () => void;
  scrimRef?: RefObject<HTMLElement | null>;
}): RefCallback<T> {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  return useCallback(
    (panel: T | null) => {
      if (!panel) return;
      type Drag = {
        state: "pending" | "dragging" | "ignored";
        x: number;
        y: number;
        offset: number;
        size: number;
        lastOffset: number;
        lastTime: number;
        velocity: number;
      };
      let drag: Drag | null = null;

      const place = (offset: number, size: number, transition: string) => {
        panel.style.transition = transition && `transform ${transition}`;
        panel.style.transform = offset
          ? direction === "down"
            ? `translateY(${offset}px)`
            : `translateX(${-offset}px)`
          : "";
        const scrim = scrimRef?.current;
        if (scrim) {
          scrim.style.transition = transition && `opacity ${transition}`;
          scrim.style.opacity = offset ? String(Math.max(0, 1 - offset / size)) : "";
        }
      };

      const onStart = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch || !(event.target instanceof Element)) {
          drag = null;
          return;
        }
        const rect = panel.getBoundingClientRect();
        drag = {
          state: canStartDrag(event.target, panel, direction) ? "pending" : "ignored",
          x: touch.clientX,
          y: touch.clientY,
          offset: 0,
          size: direction === "down" ? rect.height : rect.width,
          lastOffset: 0,
          lastTime: event.timeStamp,
          velocity: 0,
        };
      };

      const onMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!drag || drag.state === "ignored" || !touch) return;
        const dx = touch.clientX - drag.x;
        const dy = touch.clientY - drag.y;
        const along = direction === "down" ? dy : -dx;
        const across = direction === "down" ? dx : dy;
        if (drag.state === "pending") {
          if (Math.hypot(dx, dy) < SLOP_PX) return;
          if (along <= 0 || Math.abs(across) > along) {
            drag.state = "ignored";
            return;
          }
          drag.state = "dragging";
          // A drag during the entrance takes over from it.
          for (const animation of panel.getAnimations()) animation.finish();
        }
        if (event.cancelable) event.preventDefault();
        const offset = Math.max(0, along);
        const elapsed = event.timeStamp - drag.lastTime;
        if (elapsed > 0) {
          drag.velocity = (offset - drag.lastOffset) / elapsed;
          drag.lastOffset = offset;
          drag.lastTime = event.timeStamp;
        }
        drag.offset = offset;
        place(offset, drag.size, "");
      };

      const onEnd = (event: TouchEvent) => {
        const current = drag;
        drag = null;
        if (current?.state !== "dragging") return;
        // A finger that stopped before letting go isn't a flick.
        const velocity = event.timeStamp - current.lastTime > 100 ? 0 : current.velocity;
        if (shouldDismiss(current.offset, velocity, current.size)) onDismissRef.current();
        else place(0, current.size, SETTLE);
      };

      const passive = { passive: true };
      const active = { passive: false };
      panel.addEventListener("touchstart", onStart, passive);
      panel.addEventListener("touchmove", onMove, active);
      panel.addEventListener("touchend", onEnd, passive);
      panel.addEventListener("touchcancel", onEnd, passive);
      return () => {
        panel.removeEventListener("touchstart", onStart);
        panel.removeEventListener("touchmove", onMove);
        panel.removeEventListener("touchend", onEnd);
        panel.removeEventListener("touchcancel", onEnd);
      };
    },
    [direction, scrimRef],
  );
}
