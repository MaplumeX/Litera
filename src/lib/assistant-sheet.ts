import type { ReaderMode } from "@/lib/reader-mode";

/**
 * The mobile shell's assistant bottom sheet. Half keeps the Book visible
 * above it; full is the conversation alone.
 */
export type SheetSnap = "collapsed" | "half" | "full";

const SNAP_FRACTION: Record<SheetSnap, number> = { collapsed: 0, half: 0.5, full: 1 };

/** A drag shorter than this is a tap on the handle, not a resize. */
const DRAG_SLOP_PX = 32;

/**
 * One stored per-Book preference serves both shells: full screen is the
 * phone's Agent mode, and a Book reopens collapsed when last used in Reading.
 */
export function snapForReaderMode(mode: ReaderMode): SheetSnap {
  return mode === "agent" ? "full" : "collapsed";
}

export function readerModeForSnap(snap: SheetSnap): ReaderMode {
  return snap === "full" ? "agent" : "reader";
}

/** Where the sheet settles after its handle was dragged `dragDownPx` (negative: up). */
export function snapAfterDrag(start: SheetSnap, dragDownPx: number, containerHeight: number): SheetSnap {
  if (containerHeight <= 0 || Math.abs(dragDownPx) < DRAG_SLOP_PX) return start;
  const fraction = SNAP_FRACTION[start] - dragDownPx / containerHeight;
  let nearest: SheetSnap = start;
  let distance = Infinity;
  for (const snap of ["collapsed", "half", "full"] as const) {
    const next = Math.abs(SNAP_FRACTION[snap] - fraction);
    if (next < distance) {
      nearest = snap;
      distance = next;
    }
  }
  return nearest;
}
