// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/types/agent";

const runtime = vi.hoisted(() => {
  let listener: ((event: AgentEvent) => void) | undefined;
  return {
    subscribe: vi.fn((next: (event: AgentEvent) => void) => { listener = next; return () => { listener = undefined; }; }),
    emit: (event: AgentEvent) => listener?.(event),
    syncBook: vi.fn(),
    listSessions: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
    abort: vi.fn(),
    newSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    updateSessionConfig: vi.fn(async () => {}),
  };
});

vi.mock("@/agent/runtime/embedded-runtime", () => ({ embeddedAgentRuntime: runtime }));
import { useAgentBridge } from "./use-agent-bridge";

const event = (value: Omit<AgentEvent, "version"> & { version?: number }): AgentEvent =>
  ({ version: value.version ?? 1, ...value }) as AgentEvent;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAgentBridge", () => {
  it("subscribes to the local runtime and refreshes sessions when the book is ready", async () => {
    renderHook(() => useAgentBridge("book-a"));
    await act(async () => { await Promise.resolve(); });
    expect(runtime.syncBook).toHaveBeenCalledWith("book-a");
    act(() => runtime.emit(event({ type: "book_ready", bookId: "book-a" })));
    await waitFor(() => expect(runtime.listSessions).toHaveBeenCalled());
  });

  it("rejects prompts until the local book worker is ready", async () => {
    const { result } = renderHook(() => useAgentBridge("book-a"));
    await expect(result.current.prompt("hello", {}, { role: "user", content: "hello" }))
      .rejects.toThrow("Book is not ready");
    expect(runtime.prompt).not.toHaveBeenCalled();
  });

  it("passes chapterHref to the embedded runtime", async () => {
    const { result } = renderHook(() => useAgentBridge("book-a"));
    act(() => runtime.emit(event({ type: "book_ready", bookId: "book-a" })));
    await waitFor(() => expect(result.current.state.status).toBe("bookReady"));
    await act(async () => {
      await result.current.prompt(
        "hello",
        { chapterHref: "OPS/one.xhtml" },
        { role: "user", content: "hello", chapterHref: "OPS/one.xhtml" },
      );
    });
    expect(runtime.prompt).toHaveBeenCalledWith(
      "hello",
      { chapterHref: "OPS/one.xhtml" },
      expect.stringMatching(/^prompt-/),
      expect.stringMatching(/^prompt-request-/),
    );
  });

  it("replaces history before appending an edited user message", async () => {
    const { result } = renderHook(() => useAgentBridge("book-a"));
    act(() => runtime.emit(event({ type: "book_ready", bookId: "book-a" })));
    await waitFor(() => expect(result.current.state.status).toBe("bookReady"));
    await act(async () => {
      await result.current.editPrompt(2, "rewritten", {}, { role: "user", content: "rewritten" });
    });
    const promptId = runtime.prompt.mock.calls.at(-1)?.[2] as string;
    act(() => runtime.emit(event({
      type: "session_rewound",
      bookId: "book-a",
      sessionId: "session-1",
      promptId,
      messages: [{ role: "user", content: "old" }],
      version: 2,
    })));
    expect(result.current.state.messages).toEqual([
      { role: "user", content: "old" },
      { role: "user", content: "rewritten" },
    ]);
  });

  it("keeps a newly created empty session without an immediate list overwrite", () => {
    const { result } = renderHook(() => useAgentBridge("book-a"));
    act(() => runtime.emit(event({ type: "session_created", bookId: "book-a", sessionId: "new", version: 2 })));
    expect(result.current.state.sessions.map((session) => session.id)).toContain("new");
    expect(runtime.listSessions).not.toHaveBeenCalled();
  });

  it("forwards session config updates to the embedded runtime", async () => {
    const { result } = renderHook(() => useAgentBridge("book-a"));
    await act(async () => {
      await result.current.updateSessionConfig("session-1", "你是翻译助手");
    });
    expect(runtime.updateSessionConfig).toHaveBeenCalledWith(
      "session-1",
      "你是翻译助手",
      expect.stringMatching(/^update-session-config-/),
    );
  });
});
