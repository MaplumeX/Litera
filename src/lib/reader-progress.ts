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

/**
 * Whole percent for a 0–1 fraction, rounded down so the bar reads 100% only
 * at the very end, never on the last pages of a long book.
 */
export function percentOf(fraction: number): number {
  // The epsilon absorbs float noise such as 0.29 * 100 = 28.999999999999996.
  const pct = Math.floor(fraction * 100 + 1e-9);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Collapse spine section ticks into chapter ticks. `chapterOf(i)` names the
 * TOC entry section `i` belongs to; a section continuing the previous entry
 * gets no tick of its own, and neither do empty (non-linear) sections. When
 * no section maps to a TOC entry the section ticks are kept as they are.
 */
export function chapterTicks(
  sectionTicks: number[],
  chapterOf: (index: number) => unknown,
): number[] {
  if (sectionTicks.length < 2) return sectionTicks;
  const lastStart = sectionTicks.length - 2;
  const chapters = sectionTicks.slice(0, lastStart + 1).map((_, i) => chapterOf(i) ?? undefined);
  if (chapters.every((c) => c === undefined)) return sectionTicks;
  const ticks = [sectionTicks[0]];
  let current = chapters[0];
  for (let i = 1; i <= lastStart; i++) {
    if (chapters[i] === current) continue;
    current = chapters[i];
    if (sectionTicks[i] > ticks[ticks.length - 1]) ticks.push(sectionTicks[i]);
  }
  ticks.push(sectionTicks[sectionTicks.length - 1]);
  return ticks;
}

/** Start and end fractions of the chapter holding `fraction`, from chapter ticks. */
export function chapterBoundsAt(
  fraction: number,
  ticks: number[],
): { start: number; end: number } | undefined {
  const index = sectionIndexAt(fraction, ticks);
  if (index == null) return undefined;
  return { start: ticks[index], end: ticks[index + 1] };
}
