// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

let bridgeState: AgentState;

// Hoisted so identities are stable across renders, like the real hook's
// useCallback-wrapped actions.
const abort = vi.fn(async () => {});
const prompt = vi.fn();
const editPrompt = vi.fn();
const switchBranchAtAnchor = vi.fn(async () => {});

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort,
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt,
    editPrompt,
    renameSession: vi.fn(async () => {}),
    switchSession: vi.fn(async () => {}),
    updateSessionConfig: vi.fn(async () => {}),
    switchBranchAtAnchor,
  }),
}));

vi.mock("@/lib/use-agent-config", () => ({
  useAgentConfig: () => ({
    snapshot: { configured: true },
    load: vi.fn(async () => {}),
  }),
}));

// Count markdown re-parses: the proxy renders a marker per mount/update of the
// memoized TextBlock pipeline, so typing in the input must not bump the count.
let markdownRenderCount = 0;
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => {
    markdownRenderCount += 1;
    return <div data-testid="markdown-proxy">{children}</div>;
  },
}));

import { ChatPanel } from "./ChatPanel";

beforeEach(() => {
  markdownRenderCount = 0;
  bridgeState = {
    ...createAgentState("book-1"),
    status: "bookReady",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "会话", createdAt: "1", updatedAt: "1" }],
    messages: [
      { role: "user", content: "第一问" },
      { role: "assistant", content: "第一答，包含 **markdown** 与公式 $E=mc^2$" },
      { role: "user", content: "第二问" },
      { role: "assistant", content: "第二答，同样是一段较长的回答。" },
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

describe("ChatPanel render isolation", () => {
  it("does not re-parse assistant markdown while typing in the input", async () => {
    const view = render(
      <ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );

    // Two assistant messages were parsed once on mount.
    const initial = markdownRenderCount;
    expect(initial).toBeGreaterThan(0);

    const input = view.getByRole("textbox") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "追" } });
    });
    await act(async () => {
      fireEvent.change(input, { target: { value: "追问" } });
    });

    expect(markdownRenderCount).toBe(initial);
  });

  it("still re-parses when the message list actually changes", async () => {
    const view = render(
      <ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
    );
    const initial = markdownRenderCount;

    bridgeState = { ...bridgeState, messages: [...bridgeState.messages, { role: "user", content: "第三问" }] };
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);

    // Messages unchanged for existing assistant entries: no re-parse expected
    // until an assistant message itself changes.
    expect(markdownRenderCount).toBe(initial);

    bridgeState = {
      ...bridgeState,
      messages: [
        ...bridgeState.messages,
        { role: "assistant", content: "第三答" },
      ],
    };
    view.rerender(<ChatPanel currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />);

    expect(markdownRenderCount).toBe(initial + 1);
  });
});
