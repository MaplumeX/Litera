// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigSnapshot } from "@/types/agent-config";

const backend = vi.hoisted(() => ({
  config: { provider: "anthropic", model: "claude-opus-4-5" },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: { providerId?: string; model?: string }) => {
    if (command === "switch_provider") {
      backend.config = { provider: args!.providerId!, model: args!.model! };
      return null;
    }
    if (command === "get_agent_config") {
      return {
        configured: true,
        provider: backend.config.provider,
        model: backend.config.model,
        hasApiKey: true,
        providersWithKey: [],
        customProviders: [],
        thinkingLevel: "medium",
      } satisfies AgentConfigSnapshot;
    }
    return null;
  }),
}));
vi.mock("@/agent/runtime/embedded-runtime", () => ({
  embeddedAgentRuntime: { invalidateConfig: vi.fn() },
}));

import { useAgentConfig } from "./use-agent-config";

beforeEach(() => {
  backend.config = { provider: "anthropic", model: "claude-opus-4-5" };
});

describe("useAgentConfig", () => {
  it("reloads every mounted instance after one of them switches provider", async () => {
    const settings = renderHook(() => useAgentConfig());
    const chat = renderHook(() => useAgentConfig());
    await act(async () => {
      await settings.result.current.load();
      await chat.result.current.load();
    });
    expect(chat.result.current.snapshot?.provider).toBe("anthropic");

    await act(async () => {
      await settings.result.current.switchProvider("deepseek", "deepseek-v4-pro");
    });

    await waitFor(() => expect(chat.result.current.snapshot?.provider).toBe("deepseek"));
    expect(chat.result.current.snapshot?.model).toBe("deepseek-v4-pro");
  });
});
