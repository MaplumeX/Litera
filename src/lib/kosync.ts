/** A position as a KOReader Sync Progress Server reports it. */
export interface KosyncProgress {
  /** CREngine XPointer (EPUB). */
  progress: string;
  /** 0–1 book fraction. */
  percentage: number;
  device: string;
  deviceId: string;
  /** Unix seconds, stamped by the server. */
  timestamp: number;
}

/** `kosync_pull`: the remote position and when this device's position last moved. */
export interface KosyncPull {
  remote: KosyncProgress;
  localPositionUpdatedAt?: string | null;
}

/** Fractions closer than this are the same place; no point asking. */
const SAME_PLACE = 0.001;

/**
 * Whether to offer jumping to a pulled position: it must be newer than the
 * last time this device's position moved, and somewhere else in the book.
 */
export function shouldOfferJump(pull: KosyncPull, localFraction: number | undefined): boolean {
  const localMs = pull.localPositionUpdatedAt ? Date.parse(pull.localPositionUpdatedAt) : NaN;
  if (Number.isFinite(localMs) && pull.remote.timestamp * 1000 <= localMs) return false;
  return Math.abs(pull.remote.percentage - (localFraction ?? 0)) > SAME_PLACE;
}
