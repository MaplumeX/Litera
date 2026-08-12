import { useEffect, useMemo, useRef } from "react";
import {
  createDebouncedCallback,
  type DebouncedCallbackController,
} from "@/lib/debounced-callback";

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void | Promise<void>,
  delay: number,
  onError?: (error: unknown) => void,
): DebouncedCallbackController<Args> {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const controller = useMemo(
    () =>
      createDebouncedCallback<Args>(
        (...args) => callbackRef.current(...args),
        delay,
        (error) => (onErrorRef.current ?? console.error)(error),
      ),
    [delay],
  );

  useEffect(() => () => controller.cancel(), [controller]);
  return controller;
}
