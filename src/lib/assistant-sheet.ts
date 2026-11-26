import type { ReaderMode } from "@/lib/reader-mode";

/**
 * The mobile shell's assistant bottom sheet. Half keeps the Book visible
 * above it; full is the conversation alone.
 */
export type SheetSnap = "collapsed" | "half" | "full";
export type AssistantSheetTab = "guide" | "ask";

const SNAP_FRACTION: Record<SheetSnap, number> = { collapsed: 0, half: 0.5, full: 1 };

/** A drag shorter than this is a tap on the handle, not a resize. */
const DRAG_SLOP_PX = 32;

/**
 * One stored per-Book preference serves both shells: full screen is the
 * phone's Guide or Agent mode, and a Book reopens collapsed when last used in Reading.
 */
export function snapForReaderMode(mode: ReaderMode): SheetSnap {
  return mode === "reader" ? "collapsed" : "full";
}

export function sheetTabForReaderMode(mode: ReaderMode): AssistantSheetTab {
  return mode === "guide" ? "guide" : "ask";
}

export function readerModeForSnap(snap: SheetSnap, tab: AssistantSheetTab = "ask"): ReaderMode {
  if (snap !== "full") return "reader";
  return tab === "guide" ? "guide" : "agent";
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
