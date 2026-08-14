export type DesktopOs = "macos" | "windows" | "linux" | "unknown";

export function detectDesktopOs(userAgent = navigator.userAgent): DesktopOs {
  if (/Mac/i.test(userAgent)) return "macos";
  if (/Win/i.test(userAgent)) return "windows";
  if (/Linux/i.test(userAgent)) return "linux";
  return "unknown";
}

export function usesCustomWindowControls(os = detectDesktopOs()): boolean {
  return os === "windows" || os === "linux" || os === "unknown";
}
