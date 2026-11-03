import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { embeddedAgentRuntime } from "@/agent/runtime/embedded-runtime";
import { loadReadingStatsEnabled } from "@/lib/reading-stats-prefs";
import type { ReaderMode } from "@/lib/reader-mode";
import { SittingTracker } from "@/lib/sitting-tracker";

const CHECKPOINT_INTERVAL_MS = 60_000;
/** Engaged with no input: TTS playing, or an answer streaming. */
const HEARTBEAT_INTERVAL_MS = 15_000;

const documentVisible = () => document.visibilityState !== "hidden";

/**
 * Feeds what happens around an open Book to a {@link SittingTracker} and saves
 * its Sittings to the Reading log. Failing to record never interrupts reading,
 * so errors are only logged.
 */
export function useReadingTracker() {
  const pendingWrite = useRef<Promise<unknown>>(Promise.resolve());
  const engaged = useRef({ tts: false, answer: false });

  const tracker = useMemo(
    () =>
      new SittingTracker({
        isEnabled: loadReadingStatsEnabled,
        // One at a time, or an older write could land last and lose time.
        write: (sitting) => {
          pendingWrite.current = pendingWrite.current
            .then(() => invoke("record_sitting", { sitting }))
            .catch((error: unknown) => console.warn("Failed to record reading:", error));
        },
      }),
    [],
  );

  useEffect(() => {
    const onActivity = () => tracker.activity();
    const onVisibility = () => tracker.setVisible(documentVisible());
    // Capture: the chat panel and other chrome may stop propagation.
    const options = { capture: true, passive: true };
    window.addEventListener("pointerdown", onActivity, options);
    window.addEventListener("keydown", onActivity, options);
    window.addEventListener("wheel", onActivity, options);
    document.addEventListener("visibilitychange", onVisibility);
    const checkpoint = setInterval(() => tracker.checkpoint(), CHECKPOINT_INTERVAL_MS);
    const heartbeat = setInterval(() => {
      if (engaged.current.tts || engaged.current.answer) tracker.activity();
    }, HEARTBEAT_INTERVAL_MS);
    const unsubscribe = embeddedAgentRuntime.subscribe((event) => {
      if (event.type === "prompt_started") {
        engaged.current.answer = true;
        tracker.activity();
      } else if (
        event.type === "prompt_end" ||
        event.type === "prompt_aborted" ||
        event.type === "error" ||
        event.type === "book_closed"
      ) {
        engaged.current.answer = false;
        tracker.activity();
      }
    });
    return () => {
      window.removeEventListener("pointerdown", onActivity, options);
      window.removeEventListener("keydown", onActivity, options);
      window.removeEventListener("wheel", onActivity, options);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(checkpoint);
      clearInterval(heartbeat);
      unsubscribe();
    };
  }, [tracker]);

  return useMemo(
    () => ({
      begin: (bookId: string, fraction: number, mode: ReaderMode) =>
        tracker.begin(bookId, fraction, mode, documentVisible()),
      end: () => tracker.end(),
      relocate: (fraction: number) => tracker.relocate(fraction),
      setMode: (mode: ReaderMode) => tracker.setMode(mode),
      /** Pointer, key or wheel input inside the Book's iframes, which never reach the window. */
      activity: () => tracker.activity(),
      setTtsPlaying: (playing: boolean) => {
        engaged.current.tts = playing;
      },
      /** Save what is underway and wait for it. Never rejects. */
      flush: async () => {
        tracker.checkpoint();
        await pendingWrite.current;
      },
    }),
    [tracker],
  );
}
