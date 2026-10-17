import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ReaderViewHandle } from "@/components/ReaderView";
import { shouldOfferJump, type KosyncProgress, type KosyncPull } from "@/lib/kosync";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";

/** Quiet time after the last page turn before the position is pushed. */
export const KOSYNC_PUSH_DELAY_MS = 10_000;

export interface KosyncPrompt {
  remote: KosyncProgress;
  localFraction: number;
}

/**
 * KOReader Sync for the open Book: pull once when it is ready and ask before
 * jumping to a newer remote position; push the position after reading.
 * Failures are silent here; the backend records them for Settings.
 */
export function useKosync({
  bookId,
  readerRef,
  getLocalFraction,
}: {
  bookId: string | null;
  readerRef: RefObject<ReaderViewHandle | null>;
  getLocalFraction: () => number | undefined;
}) {
  const [prompt, setPrompt] = useState<KosyncPrompt | null>(null);
  const bookIdRef = useRef(bookId);
  bookIdRef.current = bookId;
  // No push until the open's pull settles, or a page turn could overwrite
  // the very position the pull is about to offer.
  const pulledRef = useRef(false);
  const promptOpenRef = useRef(false);
  promptOpenRef.current = prompt !== null;
  const lastPushedRef = useRef<string | null>(null);

  const push = useDebouncedCallback(
    async (target: string, progress: string, percentage: number) => {
      await invoke("kosync_push", { bookId: target, progress, percentage });
      lastPushedRef.current = `${target}\n${progress}`;
    },
    KOSYNC_PUSH_DELAY_MS,
    (error) => console.warn("KOReader Sync push failed:", error),
  );

  useEffect(() => {
    pulledRef.current = false;
    lastPushedRef.current = null;
    setPrompt(null);
  }, [bookId]);

  const onBookReady = useCallback(async () => {
    const target = bookIdRef.current;
    if (!target) return;
    pulledRef.current = false;
    try {
      const pull = await invoke<KosyncPull | null>("kosync_pull", { bookId: target });
      if (bookIdRef.current !== target || !pull) return;
      const localFraction = getLocalFraction();
      if (shouldOfferJump(pull, localFraction)) {
        setPrompt({ remote: pull.remote, localFraction: localFraction ?? 0 });
      }
    } catch (error) {
      console.warn("KOReader Sync pull failed:", error);
    } finally {
      if (bookIdRef.current === target) pulledRef.current = true;
    }
  }, [getLocalFraction]);

  const onRelocate = useCallback(
    (fraction: number) => {
      const target = bookIdRef.current;
      if (!target || !pulledRef.current || promptOpenRef.current) return;
      const progress = readerRef.current?.getXPointer();
      if (!progress || lastPushedRef.current === `${target}\n${progress}`) return;
      push.schedule(target, progress, fraction);
    },
    [push, readerRef],
  );

  const accept = useCallback(() => {
    if (!prompt) return;
    setPrompt(null);
    promptOpenRef.current = false;
    void readerRef.current?.goToXPointer(prompt.remote.progress, prompt.remote.percentage);
  }, [prompt, readerRef]);

  const dismiss = useCallback(() => setPrompt(null), []);

  /** Push a pending position now. Never rejects. */
  const flush = useCallback(
    () => push.flush().catch((error: unknown) => console.warn("KOReader Sync push failed:", error)),
    [push],
  );

  return { prompt, onBookReady, onRelocate, accept, dismiss, flush };
}
