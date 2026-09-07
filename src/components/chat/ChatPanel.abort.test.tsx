// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const abort = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort,
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt: vi.fn(),
    editPrompt: vi.fn(async () => {}),
    renameSession: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    updateSessionConfig: vi.fn(async () => {}),
    switchBranchAtAnchor: vi.fn(async () => {}),
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: { configured: true },
    load: vi.fn(async () => {}),
  }),
}));

import { ChatPanel } from "./ChatPanel";

beforeEach(() => {
  abort.mockClear();
  bridgeState = {
    ...createAgentState("book-1"),
    status: "prompting",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
    messages: [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "回答到一半" },
    ],
  };
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

function renderPanel() {
  return render(
    <ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
  );
}

describe("ChatPanel abort backfill removal", () => {
  it("leaves the input empty after abort (no text backfill, no highlight)", async () => {
    const view = renderPanel();
    const textarea = view.getByPlaceholderText("输入问题…") as HTMLTextAreaElement;

    // Stop the generation.
    fireEvent.click(view.getByRole("button", { name: "停止生成" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(abort).toHaveBeenCalledTimes(1);

    // The prompt settles: user message + aborted assistant message stay in the flow.
    bridgeState = {
      ...bridgeState,
      status: "bookReady",
      messages: [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "回答到一半", stopReason: "aborted" },
      ],
    };
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);

    expect(view.getByText("第一问")).toBeTruthy();
    expect(view.getByText("回答到一半")).toBeTruthy();
    // The input is not refilled with the last sent text.
    expect(textarea.value).toBe("");
    // No retry highlight ring on the composer.
    expect(textarea.className).not.toContain("ring-2");
    expect(textarea.className).not.toContain("ring-primary");
  });

  it("does not restore a pending selection after abort", async () => {
    const view = renderPanel();
    fireEvent.click(view.getByRole("button", { name: "停止生成" }));
    await act(async () => {
      await Promise.resolve();
    });

    bridgeState = {
      ...bridgeState,
      status: "bookReady",
      messages: [
        { role: "user", content: "第一问", selection: "引用的段落" },
        { role: "assistant", content: "回答到一半", stopReason: "aborted" },
      ],
    };
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);

    // No pending-selection quote chip is restored into the composer.
    expect(view.queryByText(/引用选段/)).toBeNull();
  });
});
