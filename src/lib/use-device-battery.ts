import { useEffect, useState } from "react";
import { platformBridge, type BatteryStatus } from "@/lib/platform-bridge";

/** Only query the device while battery information is actually shown. */
export function useDeviceBattery(enabled: boolean): BatteryStatus | null {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let revision = 0;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const request = ++revision;
      try {
        const next = await platformBridge.getBatteryStatus();
        if (!disposed && request === revision) setBattery(next);
      } catch {
        if (!disposed && request === revision) setBattery(null);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    const unlisten = platformBridge.listen("lifecycle", ({ state }) => {
      if (state === "foreground") void refresh();
    });
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      unlisten();
    };
  }, [enabled]);
  return enabled ? battery : null;
}
