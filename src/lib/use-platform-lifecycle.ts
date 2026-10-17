import { useEffect, useRef } from "react";
import { platformBridge } from "@/lib/platform-bridge";
import { syncBeforeExit } from "@/lib/sync-runner";

/** How long going to the background may wait on the final pushes. */
export const BACKGROUND_PUSH_TIMEOUT_MS = 5_000;

/**
 * Android never closes the window; the app goes to the background and may
 * be killed there. So: back in the foreground, pull and merge what other
 * devices did; into the background, save and push what this one did,
 * bounded like the desktop's push on close. A no-op on desktop.
 */
export function usePlatformLifecycle(options: {
  flush: () => Promise<void>;
  flushKosync: () => Promise<void>;
  syncNow: () => Promise<void>;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(
    () =>
      platformBridge.listen("lifecycle", ({ state }) => {
        const { flush, flushKosync, syncNow } = optionsRef.current;
        if (state === "foreground") {
          void syncNow();
          return;
        }
        void (async () => {
          await flush().catch(() => {
            // Already reported by the session; push whatever did save.
          });
          await Promise.all([
            syncBeforeExit(BACKGROUND_PUSH_TIMEOUT_MS).catch((error: unknown) => {
              console.warn("Sync before background failed:", error);
            }),
            Promise.race([
              flushKosync(),
              new Promise((resolve) => setTimeout(resolve, BACKGROUND_PUSH_TIMEOUT_MS)),
            ]),
          ]);
        })();
      }),
    [],
  );
}
