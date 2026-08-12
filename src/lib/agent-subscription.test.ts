import { describe, expect, it, vi } from "vitest";
import { registerAgentSubscription } from "./agent-subscription";

describe("registerAgentSubscription", () => {
  it("immediately removes a listener whose promise resolves after StrictMode cleanup", async () => {
    let resolveListen: ((cleanup: () => void) => void) | undefined;
    const cleanup = vi.fn();
    const getSnapshot = vi.fn();
    const subscription = registerAgentSubscription({
      listen: () => new Promise((resolve) => { resolveListen = resolve; }),
      getSnapshot,
      onEvent: vi.fn(),
      onSnapshot: vi.fn(),
      onError: vi.fn(),
    });
    subscription.dispose();
    resolveListen?.(cleanup);
    await subscription.ready;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it("registers before snapshot hydration and leaves no listener after disposal", async () => {
    const order: string[] = [];
    const cleanup = vi.fn(() => order.push("cleanup"));
    const subscription = registerAgentSubscription({
      listen: async () => {
        order.push("listen");
        return cleanup;
      },
      getSnapshot: async () => {
        order.push("snapshot");
        return { protocolVersion: 1, version: 1, generation: 1, status: "ready" };
      },
      onEvent: vi.fn(),
      onSnapshot: () => order.push("hydrated"),
      onError: vi.fn(),
    });
    await subscription.ready;
    subscription.dispose();
    expect(order).toEqual(["listen", "snapshot", "hydrated", "cleanup"]);
  });
});
