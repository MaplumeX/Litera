import type { AgentEvent, AgentSnapshot } from "@/types/agent";

type Unlisten = () => void;

export interface AgentSubscriptionDependencies {
  listen: (handler: (event: AgentEvent) => void) => Promise<Unlisten>;
  getSnapshot: () => Promise<AgentSnapshot>;
  onEvent: (event: AgentEvent) => void;
  onSnapshot: (snapshot: AgentSnapshot) => void;
  onRegistered?: () => void;
  onError: (error: unknown) => void;
}

export function registerAgentSubscription(dependencies: AgentSubscriptionDependencies): {
  ready: Promise<void>;
  dispose: () => void;
} {
  let disposed = false;
  let unlisten: Unlisten | undefined;
  const ready = dependencies.listen(dependencies.onEvent).then(async (cleanup) => {
    if (disposed) {
      cleanup();
      return;
    }
    unlisten = cleanup;
    dependencies.onRegistered?.();
    const snapshot = await dependencies.getSnapshot();
    if (!disposed) dependencies.onSnapshot(snapshot);
  }).catch((error) => {
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
