export type LatestSerializedTaskResult<T> =
  | { status: "completed"; value: T }
  | { status: "stale" };

export interface LatestSerializedTask<T> {
  promise: Promise<LatestSerializedTaskResult<T>>;
  isLatest: () => boolean;
}

export interface LatestSerializedTaskController {
  run: <T>(operation: () => Promise<T>) => LatestSerializedTask<T>;
}

/**
 * Serializes side-effecting work while giving newer requests precedence over
 * older results. A task that is already running is allowed to finish, but its
 * result/error becomes stale; the newest queued task then runs next.
 */
export function createLatestSerializedTaskController(): LatestSerializedTaskController {
  let latestTicket = 0;
  let tail: Promise<void> = Promise.resolve();

  return {
    run: <T>(operation: () => Promise<T>): LatestSerializedTask<T> => {
      const ticket = ++latestTicket;
      const isLatest = () => ticket === latestTicket;
      const promise = tail.then(async (): Promise<LatestSerializedTaskResult<T>> => {
        if (!isLatest()) return { status: "stale" };
        try {
          const value = await operation();
          return isLatest() ? { status: "completed", value } : { status: "stale" };
        } catch (error) {
          // Errors from a superseded request must not replace the current UX.
          if (!isLatest()) return { status: "stale" };
          throw error;
        }
      });
      tail = promise.then(
        () => undefined,
        () => undefined,
      );
      return { promise, isLatest };
    },
  };
}
