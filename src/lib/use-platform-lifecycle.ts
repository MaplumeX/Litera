import { useEffect, useRef } from "react";
import { platformBridge } from "@/lib/platform-bridge";
import { pushBeforeLeaving } from "@/lib/sync-runner";

/**
 * Android never closes the window; the app goes to the background and may
 * be killed there. So: back in the foreground, pull and merge what other
 * devices did; into the background, save and push what this one did,
 * bounded like the desktop's push on close. A no-op on desktop.
 */
export function usePlatformLifecycle(options: {
  flush: () => Promise<void>;
  flushKosync: () => Promise<void>;
  syncOnReturn: () => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(
    () =>
      platformBridge.listen("lifecycle", ({ state }) => {
        const { flush, flushKosync, syncOnReturn } = optionsRef.current;
        if (state === "foreground") {
          syncOnReturn();
          return;
        }
        void (async () => {
          await flush().catch(() => {
            // Already reported by the session; push whatever did save.
          });
          await pushBeforeLeaving(flushKosync);
        })();
      }),
    [],
  );
}
