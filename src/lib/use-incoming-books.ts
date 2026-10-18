import { useEffect, useRef } from "react";
import { platformBridge, type IncomingBook } from "@/lib/platform-bridge";

/**
 * Books handed to the app by "Open with" or a share: imported, then the
 * last one opens, as a desktop "Open with" does. Covers a warm start (the
 * `incomingBooks` event) and a cold start (books that arrived before the
 * WebView listened). A no-op on desktop.
 */
export function useIncomingBooks(options: {
  importIncoming: (books: IncomingBook[]) => Promise<string[]>;
  openBook: (bookId: string) => void | Promise<void>;
}) {
  const importRef = useRef(options.importIncoming);
  const openRef = useRef(options.openBook);
  importRef.current = options.importIncoming;
  openRef.current = options.openBook;

  useEffect(() => {
    let disposed = false;
    // One batch at a time, in arrival order.
    let chain = Promise.resolve();
    const handle = (books: IncomingBook[]) => {
      if (books.length === 0) return;
      chain = chain
        .then(async () => {
          if (disposed) return;
          const ids = await importRef.current(books);
          const last = ids[ids.length - 1];
          if (!disposed && last) await openRef.current(last);
        })
        .catch((error: unknown) => console.error("incoming books error:", error));
    };
    // Listen first, then drain what queued before: once the listener is
    // registered natively, the plugin delivers each batch to exactly one of
    // the two. Draining earlier could miss a batch queued in between.
    const unlisten = platformBridge.listen("incomingBooks", ({ books }) => handle(books));
    void unlisten.ready
      .then(() => (disposed ? [] : platformBridge.takePendingIncomingBooks()))
      .then(handle)
      .catch((error: unknown) => console.error("pending incoming books error:", error));
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);
}
