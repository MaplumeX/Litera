import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BookRecord, ReadingStatus } from "@/types/library";
import { FINISH_FRACTION } from "@/lib/library-shelf";
import { notifySyncActivity } from "@/lib/sync-activity";

/**
 * A relocate that moves less than this from where the Book opened is layout
 * noise (re-pagination after styles apply), not reading.
 */
const MOVE_EPSILON = 1e-4;

interface OpenBook {
  bookId: string;
  status: ReadingStatus;
  /** Fraction of the relocate that restored the saved position. */
  openedAt: number | null;
  started: boolean;
  prompted: boolean;
}

/**
 * Advances a Book's Reading status while it is open in the reader.
 *
 * - The first relocate restores the saved position and does not count as
 *   reading. The first one that moves away from it calls `mark_book_started`,
 *   which turns an unread or paused Book into a reading one.
 * - Moving to `FINISH_FRACTION` or past it offers "Mark as finished" once per
 *   open, unless the Book is already finished. Re-opening a Book that was
 *   left at the end does not re-offer it until the reader moves.
 *
 * `begin` / `end` bracket an open so re-opening the same Book starts fresh.
 */
export function useReadingStatus({ onError }: { onError: (error: unknown) => void }) {
  const openRef = useRef<OpenBook | null>(null);
  const [finishPromptBookId, setFinishPromptBookId] = useState<string | null>(null);

  const begin = useCallback((bookId: string, status: ReadingStatus) => {
    openRef.current = { bookId, status, openedAt: null, started: false, prompted: false };
    setFinishPromptBookId(null);
  }, []);

  const end = useCallback(() => {
    openRef.current = null;
    setFinishPromptBookId(null);
  }, []);

  const onRelocate = useCallback(
    (fraction: number) => {
      const open = openRef.current;
      if (!open) return;
      if (open.openedAt === null) {
        open.openedAt = fraction;
        return;
      }
      if (Math.abs(fraction - open.openedAt) <= MOVE_EPSILON) return;
      if (!open.started) {
        open.started = true;
        if (open.status === "unread" || open.status === "paused") {
          open.status = "reading";
          invoke<BookRecord>("mark_book_started", { bookId: open.bookId })
            .then(() => notifySyncActivity())
            .catch(onError);
        }
      }
      if (!open.prompted && open.status !== "finished" && fraction >= FINISH_FRACTION) {
        open.prompted = true;
        setFinishPromptBookId(open.bookId);
      }
    },
    [onError],
  );

  const markFinished = useCallback(async () => {
    const open = openRef.current;
    setFinishPromptBookId(null);
    if (!open) return;
    try {
      await invoke<BookRecord>("update_book_curation", {
        bookId: open.bookId,
        readingStatus: "finished",
        starred: null,
      });
      open.status = "finished";
      notifySyncActivity();
    } catch (error) {
      onError(error);
    }
  }, [onError]);

  const dismissFinishPrompt = useCallback(() => setFinishPromptBookId(null), []);

  return {
    begin,
    end,
    onRelocate,
    finishPromptOpen: finishPromptBookId !== null,
    markFinished,
    dismissFinishPrompt,
  };
}
