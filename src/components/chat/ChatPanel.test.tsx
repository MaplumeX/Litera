// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const newSession = vi.fn(async () => {});
const switchSession = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(),
    newSession,
    prompt: vi.fn(),
    editPrompt: vi.fn(),
    renameSession: vi.fn(),
    restart: vi.fn(),
    switchSession,
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: { configured: true },
    load: vi.fn(async () => {}),
  }),
}));

import { ChatPanel } from "./ChatPanel";

function readyState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    ...createAgentState("book-1"),
    status: "bookReady",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
    ...overrides,
  };
}

beforeEach(() => {
  newSession.mockClear();
  switchSession.mockClear();
  bridgeState = readyState();
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openSessionList() {
  const view = render(<ChatPanel currentChapterIndex={0} bookId="book-1" />);
  fireEvent.click(view.getByRole("button", { name: "会话列表" }));
  return view;
}

async function clickNewSession(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "新建会话" }));
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ChatPanel new session", () => {
  it("reuses the current empty session without calling new_session", async () => {
    bridgeState = readyState({ messages: [] });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });

  it("creates a session when the current one already has messages", async () => {
    bridgeState = readyState({
      messages: [{ role: "user", content: "已有提问" }],
    });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });

  it("creates a session when there is no active session", async () => {
    bridgeState = readyState({ sessionId: null, sessions: [], messages: [] });
    const view = openSessionList();

    await clickNewSession(view);

    expect(newSession).toHaveBeenCalledTimes(1);
    expect(switchSession).not.toHaveBeenCalled();
    expect(view.queryByRole("button", { name: "新建会话" })).toBeNull();
    expect(document.activeElement).toBe(view.getByPlaceholderText("输入问题…"));
  });
});
