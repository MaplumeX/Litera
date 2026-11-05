import { useCallback, useEffect, useRef, useState } from "react";

export const CHROME_IDLE_MS = 3000;

/**
 * Fades the reader's bars once the pointer has left them alone. The Book renders
 * in its own frame, so pointer moves over the page never reach `wake`: reading,
 * and turning pages by key, stays undisturbed, and reaching for a bar brings the
 * bars back. A bar under the pointer (marked `data-reader-chrome`) keeps them up.
 */
export function useIdleChrome(enabled: boolean) {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (document.querySelector("[data-reader-chrome]:hover, [data-reader-chrome]:focus-within")) {
        arm();
        return;
      }
      setIdle(true);
    }, CHROME_IDLE_MS);
  }, []);

  const wake = useCallback(() => {
    setIdle(false);
    if (enabled) arm();
  }, [arm, enabled]);

  useEffect(() => {
    setIdle(false);
    if (enabled) arm();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [arm, enabled]);

  return { idle: enabled && idle, wake };
}
