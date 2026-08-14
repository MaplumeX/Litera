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
