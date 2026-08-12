export interface DebouncedCallbackController<Args extends unknown[]> {
  schedule: (...args: Args) => void;
  flush: () => Promise<void>;
  cancel: () => void;
  readonly pending: boolean;
}

export function createDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void | Promise<void>,
  delay: number,
  onError: (error: unknown) => void = console.error,
): DebouncedCallbackController<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Args | null = null;
  let running: Promise<void> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const run = (args: Args): Promise<void> => {
    const predecessor = running?.catch(() => undefined) ?? Promise.resolve();
    const invocation = predecessor.then(() => callback(...args));
    const tracked = invocation.finally(() => {
      if (running === tracked) running = null;
    });
    running = tracked;
    return tracked;
  };

  const executePending = (): Promise<void> => {
    clearTimer();
    const args = pendingArgs;
    pendingArgs = null;
    return args ? run(args) : (running ?? Promise.resolve());
  };

  return {
    schedule: (...args) => {
      clearTimer();
      pendingArgs = args;
      timer = setTimeout(() => {
        void executePending().catch(onError);
      }, delay);
    },
    flush: executePending,
    cancel: () => {
      clearTimer();
      pendingArgs = null;
    },
    get pending() {
      return pendingArgs !== null;
    },
  };
}
