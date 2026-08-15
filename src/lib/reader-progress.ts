/** Map a pointer X on a strip to a clamped 0–1 book fraction. */
export function fractionFromPointer(
  clientX: number,
  left: number,
  width: number,
): number {
  if (width <= 0) return 0;
  const frac = (clientX - left) / width;
  if (frac <= 0) return 0;
  if (frac >= 1) return 1;
  return frac;
}

export const DRAG_SLOP_PX = 3;

/** True when horizontal travel is a drag rather than a click. */
export function movedPastSlop(deltaX: number, slop = DRAG_SLOP_PX): boolean {
  return Math.abs(deltaX) >= slop;
}

/**
 * Spine section index for a 0–1 book fraction given `getSectionFractions()` ticks.
 * Ticks are section starts plus a trailing 1; the last value is not a section.
 */
export function sectionIndexAt(fraction: number, ticks: number[]): number | undefined {
  if (ticks.length < 2) return undefined;
  let index = 0;
  const lastStart = ticks.length - 2;
  for (let i = 1; i <= lastStart; i++) {
    if (fraction >= ticks[i]) index = i;
    else break;
  }
  return index;
}
