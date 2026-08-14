// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => listenMock(event, handler),
}));

import { useAgentBridge } from "./use-agent-bridge";
import type { AgentEvent, AgentSnapshot } from "@/types/agent";

interface CommandReceipt {
  requestId: string;
  promptId?: string;
}

/**
 * A controlled Tauri event/listen + invoke harness.
 * `listen` resolves immediately so `registerAgentSubscription` proceeds to
 * snapshot hydration.  The captured handler lets tests emit synthetic events.
 */
interface Harness {
  emit: (event: AgentEvent) => void;
  unlisten: () => void;
}

function makeSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    protocolVersion: 1,
    version: 1,
    generation: 1,
    status: "ready",
    ...overrides,
  };
}

function makeEvent(event: Partial<AgentEvent> & { type: AgentEvent["type"] }): AgentEvent {
  return {
    protocolVersion: 1,
    version: 1,
    generation: 1,
    seq: 1,
    ...event,
  } as AgentEvent;
}

function setupListen(): Harness {
  let handler: ((event: { payload: unknown }) => void) | undefined;
  listenMock.mockImplementation((_event, h) => {
    handler = h;
    return Promise.resolve(() => {
      handler = undefined;
    });
  });
  return {
    emit: (event) => act(() => handler?.({ payload: event })),
    unlisten: () => {
      handler = undefined;
    },
  };
}

function setupInvoke() {
  invokeMock.mockImplementation((cmd: string) => {
    // Most commands return a CommandReceipt; get_agent_snapshot returns a snapshot.
    if (cmd === "get_agent_snapshot") {
      return Promise.resolve(makeSnapshot());
    }
    return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
  });
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  setupInvoke();
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Helper: render the hook, wait for the subscription to hydrate (listen resolves
 * then get_agent_snapshot returns), and return controls.
 */
async function renderBridge(bookId: string) {
  const harness = setupListen();
  const utils = renderHook((id: string) => useAgentBridge(id), {
    initialProps: bookId,
  });
  // Allow listen promise + getSnapshot + onSnapshot to flush.
  await waitFor(() => expect(listenMock).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, harness };
}

describe("useAgentBridge", () => {
  it("T1: bookId change does not invoke list_sessions or switch_session", async () => {
    const { result, rerender, harness } = await renderBridge("book-a");

    invokeMock.mockClear();
    // Re-render with a new bookId — the book_changed effect fires but must
    // not issue any dependency-on-currentBook commands.
    rerender("book-b");
    await act(async () => {
      await Promise.resolve();
    });

    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).not.toContain("list_sessions");
    expect(commands).not.toContain("switch_session");
    harness.unlisten();
  });

  it("T2: book_ready event triggers list_sessions exactly once", async () => {
    const { result, harness } = await renderBridge("book-b");
    invokeMock.mockClear();

    harness.emit(makeEvent({ type: "book_ready", bookId: "book-b", version: 2, seq: 2 }));
    await act(async () => {
      await Promise.resolve();
    });

    const listCalls = invokeMock.mock.calls.filter((c) => c[0] === "list_sessions");
    expect(listCalls).toHaveLength(1);
    expect(result.current.state.status).toBe("bookReady");
    harness.unlisten();
  });

  it("T3: hydrate loadingBook + sessionId stores pending; book_ready then switches", async () => {
    // Snapshot arrives with loadingBook status and a sessionId (replay scenario).
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({
            version: 1,
            generation: 1,
            status: "loadingBook",
            bookId: "book-b",
            sessionId: "session-pending",
          }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });

    const { result, harness } = await renderBridge("book-b");

    // Right after hydration, switch_session must NOT have been called yet.
    await act(async () => {
      await Promise.resolve();
    });
    const switchCallsBefore = invokeMock.mock.calls.filter((c) => c[0] === "switch_session");
    expect(switchCallsBefore).toHaveLength(0);

    // Now emit book_ready — should trigger listSessions + switchSession(pending).
    invokeMock.mockClear();
    harness.emit(makeEvent({ type: "book_ready", bookId: "book-b", version: 2, seq: 2 }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "list_sessions",
      expect.objectContaining({ bookId: "book-b" }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "switch_session",
      expect.objectContaining({ bookId: "book-b", sessionId: "session-pending" }),
    );
    expect(result.current.state.status).toBe("bookReady");
    harness.unlisten();
  });

  it("T4: prompt() rejects and agent_prompt is NOT invoked when status !== bookReady", async () => {
    // Snapshot arrives while the book is still loading so the bridge never
    // reaches bookReady — the prompt guard must reject before invoking.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "loadingBook", bookId: "book-a" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");

    expect(result.current.state.status).not.toBe("bookReady");

    invokeMock.mockClear();
    await expect(
      result.current.prompt("hello", {}, { role: "user", content: "hello" }),
    ).rejects.toThrow("Book is not ready");

    const promptCalls = invokeMock.mock.calls.filter((c) => c[0] === "agent_prompt");
    expect(promptCalls).toHaveLength(0);
    harness.unlisten();
  });

  it("T6: editPrompt rejects and agent_edit_prompt is NOT invoked when status !== bookReady", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "loadingBook", bookId: "book-a" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");

    expect(result.current.state.status).not.toBe("bookReady");

    invokeMock.mockClear();
    await expect(
      result.current.editPrompt(0, "hello", {}, { role: "user", content: "hello" }),
    ).rejects.toThrow("Book is not ready");

    const editCalls = invokeMock.mock.calls.filter((c) => c[0] === "agent_edit_prompt");
    expect(editCalls).toHaveLength(0);
    harness.unlisten();
  });

  it("prompt() sends chapterHref and never chapterIndex", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "bookReady", bookId: "book-a", sessionId: "session-1" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");
    await waitFor(() => expect(result.current.state.status).toBe("bookReady"));

    await act(async () => {
      await result.current.prompt(
        "hello",
        { chapterHref: "OEBPS/ch1.xhtml" },
        { role: "user", content: "hello", chapterHref: "OEBPS/ch1.xhtml" },
      );
    });

    const promptCall = invokeMock.mock.calls.find((c) => c[0] === "agent_prompt");
    expect(promptCall?.[1]).toEqual(expect.objectContaining({
      chapterHref: "OEBPS/ch1.xhtml",
    }));
    expect(promptCall?.[1]).not.toHaveProperty("chapterIndex");
    harness.unlisten();
  });

  it("prompt() omits an empty chapterHref instead of sending a blank locator", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "bookReady", bookId: "book-a", sessionId: "session-1" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");
    await waitFor(() => expect(result.current.state.status).toBe("bookReady"));

    await act(async () => {
      await result.current.prompt("hello", { chapterHref: "" }, { role: "user", content: "hello" });
    });

    const promptCall = invokeMock.mock.calls.find((c) => c[0] === "agent_prompt");
    expect(promptCall?.[1]).toEqual(expect.objectContaining({ chapterHref: null }));
    expect(promptCall?.[1]).not.toHaveProperty("chapterIndex");
    harness.unlisten();
  });

  it("T7: session_rewound replaces messages then appends the pending edited user message", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "bookReady", bookId: "book-a", sessionId: "session-1" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");

    await act(async () => {
      await result.current.editPrompt(
        2,
        "rewritten",
        { selection: "quoted", chapterHref: "OEBPS/ch1.xhtml" },
        { role: "user", content: "rewritten", selection: "quoted", chapterHref: "OEBPS/ch1.xhtml" },
      );
    });

    const editCall = invokeMock.mock.calls.find((c) => c[0] === "agent_edit_prompt");
    expect(editCall).toBeDefined();
    expect(editCall?.[1]).toEqual(expect.objectContaining({
      selection: "quoted",
      chapterHref: "OEBPS/ch1.xhtml",
    }));
    expect(editCall?.[1]).not.toHaveProperty("chapterIndex");
    const promptId = (editCall?.[1] as { promptId: string }).promptId;

    harness.emit(
      makeEvent({
        type: "session_rewound",
        bookId: "book-a",
        sessionId: "session-1",
        promptId,
        requestId: "edit-request",
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
        ],
        version: 2,
        seq: 2,
      }),
    );

    expect(result.current.state.messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "rewritten", selection: "quoted", chapterHref: "OEBPS/ch1.xhtml" },
    ]);
    expect(result.current.state.promptId).toBe(promptId);
    harness.unlisten();
  });

  it("T5: session_created event does not trigger list_sessions", async () => {
    // Set up a bookReady state first.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_agent_snapshot") {
        return Promise.resolve(
          makeSnapshot({ status: "bookReady", bookId: "book-a", sessionId: "session-1" }),
        );
      }
      return Promise.resolve({ requestId: `${cmd}-receipt` } as CommandReceipt);
    });
    const { result, harness } = await renderBridge("book-a");

    invokeMock.mockClear();

    harness.emit(
      makeEvent({
        type: "session_created",
        bookId: "book-a",
        sessionId: "session-new",
        version: 2,
        seq: 2,
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const listCalls = invokeMock.mock.calls.filter((c) => c[0] === "list_sessions");
    expect(listCalls).toHaveLength(0);
    // Optimistic insert happened.
    expect(result.current.state.sessions.map((s) => s.id)).toContain("session-new");
    harness.unlisten();
  });
});