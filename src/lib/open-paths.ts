type Unlisten = () => void;

/** argv + macOS Opened can deliver the same file a few seconds apart. */
export const RECENT_OPEN_PATH_MS = 5_000;

export interface OpenPathsListenerDependencies {
  listen: (handler: () => void) => Promise<Unlisten>;
  takePending: () => Promise<string[]>;
  importPaths: (paths: string[]) => Promise<string[]>;
  openBook: (bookId: string) => void | Promise<void>;
  onError: (error: unknown) => void;
  now?: () => number;
}

export function filterRecentOpenPaths(
  paths: string[],
  recent: Map<string, number>,
  now: number,
  windowMs = RECENT_OPEN_PATH_MS,
): string[] {
  const next: string[] = [];
  for (const path of paths) {
    const seen = recent.get(path);
    if (seen != null && now - seen < windowMs) continue;
    recent.set(path, now);
    next.push(path);
  }
  return next;
}

export function registerOpenPathsListener(dependencies: OpenPathsListenerDependencies): {
  ready: Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let unlisten: Unlisten | undefined;
  let chain = Promise.resolve();
  const recent = new Map<string, number>();
  const now = dependencies.now ?? Date.now;

  const drain = () => {
    chain = chain
      .then(async () => {
        if (disposed) return;
        let last: string | undefined;
        while (!disposed) {
          const paths = filterRecentOpenPaths(await dependencies.takePending(), recent, now());
          if (paths.length === 0) break;
          const successful = await dependencies.importPaths(paths);
          if (successful.length === 0) {
            for (const path of paths) recent.delete(path);
          }
          const next = successful[successful.length - 1];
          if (next) last = next;
        }
        if (!disposed && last) await dependencies.openBook(last);
      })
      .catch((error: unknown) => {
        if (!disposed) dependencies.onError(error);
      });
  };

  const ready = dependencies
    .listen(() => {
      drain();
    })
    .then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      drain();
    })
    .catch((error: unknown) => {
      if (!disposed) dependencies.onError(error);
    });

  return {
    ready,
    dispose: () => {
      disposed = true;
      unlisten?.();
      unlisten = undefined;
    },
  };
}
