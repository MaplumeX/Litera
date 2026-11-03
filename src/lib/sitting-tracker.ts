import type { ReaderMode } from "@/lib/reader-mode";

/** The most one gap between activities can count for; a longer gap ends the Sitting. */
export const IDLE_CAP_MS = 180_000;
/** A Sitting shorter than this is never written: opening a Book to look something up. */
export const MIN_SITTING_SECONDS = 30;
/** A relocate moving less than this is layout noise (re-pagination), not reading. */
const MOVE_EPSILON = 1e-4;

export interface Sitting {
  id: string;
  bookId: string;
  /** RFC 3339 with the UTC offset, so its date is the local date as lived. */
  start: string;
  seconds: number;
  from: number;
  to: number;
  mode: ReaderMode;
}

export interface SittingTrackerOptions {
  /** Called with a Sitting's latest state; the same `id` replaces the earlier one. */
  write: (sitting: Sitting) => void;
  /** Off drops the Sitting underway; what was already written stays. */
  isEnabled: () => boolean;
  now?: () => number;
  newId?: () => string;
}

interface OpenBook {
  bookId: string;
  mode: ReaderMode;
  fraction: number;
  /** A relocate has restored the saved position. */
  restored: boolean;
}

interface Current {
  id: string;
  startMs: number;
  from: number;
  to: number;
  mode: ReaderMode;
  activeMs: number;
  lastWrittenSeconds: number;
}

function pad(value: number, length = 2): string {
  return String(Math.trunc(Math.abs(value))).padStart(length, "0");
}

/** RFC 3339 in the device's local time, with its UTC offset. */
export function localTimestamp(ms: number): string {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

function sameLocalDate(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * Turns what happens in the reader into Sittings. See the time rules in
 * `.scratch/reading-stats/spec.md`. Time is credited when the next activity
 * arrives, so a Book left open counts for one capped gap, however long it sits.
 * Holds no timers: the caller decides when to checkpoint and heartbeat.
 */
export class SittingTracker {
  private readonly write: (sitting: Sitting) => void;
  private readonly isEnabled: () => boolean;
  private readonly now: () => number;
  private readonly newId: () => string;
  private open: OpenBook | null = null;
  private current: Current | null = null;
  private lastActivityAt = 0;
  private visible = true;
  private hiddenAt = 0;

  constructor(options: SittingTrackerOptions) {
    this.write = options.write;
    this.isEnabled = options.isEnabled;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** A Book opened; the open is the first activity. Ends any Book still open. */
  begin(bookId: string, fraction: number, mode: ReaderMode, visible = true): void {
    this.end();
    this.open = { bookId, mode, fraction, restored: false };
    this.visible = visible;
    this.hiddenAt = this.now();
    if (visible) this.activity();
  }

  /** The reader did something. */
  activity(): void {
    if (!this.open || !this.visible) return;
    if (!this.isEnabled()) {
      this.current = null;
      return;
    }
    const at = this.now();
    if (!this.current) {
      this.startSitting(at);
      return;
    }
    const gap = this.pendingMs(at);
    this.current.activeMs += gap;
    if (at - this.lastActivityAt > IDLE_CAP_MS || !sameLocalDate(this.current.startMs, at)) {
      this.closeSitting();
      this.startSitting(at);
      return;
    }
    this.lastActivityAt = at;
  }

  /**
   * The position changed. The first relocate of an open restores the saved
   * position and later tiny ones are re-pagination: neither is activity.
   */
  relocate(fraction: number): void {
    const open = this.open;
    if (!open) return;
    const restoring = !open.restored;
    const moved = !restoring && Math.abs(fraction - open.fraction) > MOVE_EPSILON;
    open.restored = true;
    open.fraction = fraction;
    if (restoring && this.current) this.current.from = fraction;
    if (moved) this.activity();
    if ((restoring || moved) && this.current) this.current.to = fraction;
  }

  /** Reading mode switched: a Sitting has one mode, so a new one starts. */
  setMode(mode: ReaderMode): void {
    const open = this.open;
    if (!open || open.mode === mode) return;
    if (this.current) {
      this.current.activeMs += this.pendingMs(this.now());
      this.closeSitting();
    }
    open.mode = mode;
    this.activity();
  }

  /**
   * The window was hidden or shown. Hidden time never counts; coming back
   * within the cap continues the same Sitting, so switching windows does not
   * fragment it.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    const at = this.now();
    if (!visible) {
      if (this.current) {
        this.current.activeMs += this.pendingMs(at);
        this.lastActivityAt = at;
      }
      this.checkpoint();
      this.visible = false;
      this.hiddenAt = at;
      return;
    }
    this.visible = true;
    if (!this.open) return;
    if (this.current) {
      if (at - this.hiddenAt > IDLE_CAP_MS || !sameLocalDate(this.current.startMs, at)) {
        this.closeSitting();
      } else {
        this.lastActivityAt = at;
        return;
      }
    }
    this.activity();
  }

  /** Save the Sitting underway, once it is long enough and has changed. */
  checkpoint(): void {
    if (!this.open || !this.current) return;
    if (!this.isEnabled()) {
      this.current = null;
      return;
    }
    const seconds = this.projectedSeconds();
    if (seconds < MIN_SITTING_SECONDS || seconds === this.current.lastWrittenSeconds) return;
    this.current.lastWrittenSeconds = seconds;
    this.write({
      id: this.current.id,
      bookId: this.open.bookId,
      start: localTimestamp(this.current.startMs),
      seconds,
      from: this.current.from,
      to: this.current.to,
      mode: this.current.mode,
    });
  }

  /** The Book closed; closing is the last activity. */
  end(): void {
    if (!this.open) return;
    if (this.current) this.current.activeMs += this.pendingMs(this.now());
    this.closeSitting();
    this.open = null;
  }

  private pendingMs(at: number): number {
    if (!this.visible) return 0;
    return Math.min(Math.max(0, at - this.lastActivityAt), IDLE_CAP_MS);
  }

  private projectedSeconds(): number {
    if (!this.current) return 0;
    return Math.round((this.current.activeMs + this.pendingMs(this.now())) / 1000);
  }

  private startSitting(at: number): void {
    const open = this.open;
    if (!open) return;
    this.current = {
      id: this.newId(),
      startMs: at,
      from: open.fraction,
      to: open.fraction,
      mode: open.mode,
      activeMs: 0,
      lastWrittenSeconds: 0,
    };
    this.lastActivityAt = at;
  }

  /** Final write of the Sitting, with whatever time it has been credited. */
  private closeSitting(): void {
    if (!this.current) return;
    // The caller already credited the last gap into activeMs.
    this.lastActivityAt = this.now();
    this.checkpoint();
    this.current = null;
  }
}
