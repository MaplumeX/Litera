export type DesktopOs = "macos" | "windows" | "linux" | "unknown";

export function detectDesktopOs(userAgent = navigator.userAgent): DesktopOs {
  if (/Mac/i.test(userAgent)) return "macos";
  if (/Win/i.test(userAgent)) return "windows";
  if (/Linux/i.test(userAgent)) return "linux";
  return "unknown";
}

/** Android has no window to minimize or close, even in the desktop shell (tablets). */
export function usesCustomWindowControls(os = detectDesktopOs(), android = isAndroid()): boolean {
  if (android) return false;
  return os === "windows" || os === "linux" || os === "unknown";
}

export function isAndroid(userAgent = navigator.userAgent): boolean {
  return /Android/i.test(userAgent);
}

export type Shell = "mobile" | "desktop";

/**
 * Below this shortest side (CSS px) an Android screen is a phone. The
 * shortest side, not the width, so rotating a phone keeps its shell.
 */
const PHONE_MAX_SHORT_SIDE_PX = 600;

/** Android phones get the mobile shell; desktops, tablets and wide screens the desktop one. */
export function selectShell({
  userAgent = navigator.userAgent,
  width = window.innerWidth,
  height = window.innerHeight,
}: { userAgent?: string; width?: number; height?: number } = {}): Shell {
  if (!isAndroid(userAgent)) return "desktop";
  return Math.min(width, height) < PHONE_MAX_SHORT_SIDE_PX ? "mobile" : "desktop";
}
