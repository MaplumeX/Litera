// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentState, type AgentState } from "@/lib/agent-reducer";

const switchBranchAtAnchor = vi.fn(async () => {});
const editPrompt = vi.fn(async () => {});
let bridgeState: AgentState;

vi.mock("@/lib/use-agent-bridge", () => ({
  useAgentBridge: () => ({
    state: bridgeState,
    abort: vi.fn(),
    deleteSession: vi.fn(async () => {}),
    newSession: vi.fn(async () => {}),
    prompt: vi.fn(),
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

import { ChatPanel } from "./ChatPanel";

/**
 * Session with a fork at the first message (created by editing it):
 *
 *   u1 "第一问"  -> a1 "第一答"          (branch 1)
 *   u1b "改写"   -> a1b "新答案"         (branch 2, active)
 *
 * `branchAnchors` is index-aligned with the visible messages.
 */
function forkedState(overrides: Partial<AgentState> = {}): AgentState {
  const info = {
    options: [
      { anchorId: "u1", preview: "第一问" },
      { anchorId: "u1b", preview: "改写" },
    ],
    activeIndex: 1,
  };
  return {
    ...createAgentState("book-1"),
    status: "bookReady",
    sessionId: "session-1",
    sessions: [{ id: "session-1", title: "新会话", createdAt: "1", updatedAt: "1" }],
    messages: [
      { role: "user", content: "改写" },
      { role: "assistant", content: "新答案" },
    ],
    branchAnchors: ["u1b", "a1b"],
    branchNavigation: { u1b: info },
    ...overrides,
  };
}

beforeEach(() => {
  switchBranchAtAnchor.mockClear();
  editPrompt.mockClear();
  bridgeState = forkedState();
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

function renderWorkspace() {
  return render(
    <ChatPanel variant="workspace" currentChapterHref="OEBPS/ch1.xhtml" bookId="book-1" />,
  );
}

describe("ChatPanel branch switcher", () => {
  it("renders the switcher on forked user messages with the active position", () => {
    const view = renderWorkspace();
    const switcher = view.getByTestId("branch-switcher");
    expect(switcher).toBeTruthy();
    expect(view.getByText("2/2")).toBeTruthy();
  });

  it("does not render the switcher without fork navigation data", () => {
    bridgeState = forkedState({ branchNavigation: {} });
    const view = renderWorkspace();
    expect(view.queryByTestId("branch-switcher")).toBeNull();
    // The message itself still renders.
    expect(view.getByText("改写")).toBeTruthy();
  });

  it("does not render the switcher while anchors are stale (streaming tail)", () => {
    // Messages appended optimistically grow past the anchor array.
    bridgeState = forkedState({
      status: "prompting",
      messages: [
        { role: "user", content: "改写" },
        { role: "assistant", content: "新答案" },
        { role: "user", content: "追问" },
      ],
      branchAnchors: ["u1b", "a1b"],
    });
    const view = renderWorkspace();
    // Index 2 has no anchor — no crash, and the anchored message keeps its switcher.
    expect(view.getByTestId("branch-switcher")).toBeTruthy();
    expect(view.getByText("追问")).toBeTruthy();
  });

  it("calls the bridge with the target sibling anchor and direction", async () => {
    const view = renderWorkspace();
    fireEvent.click(view.getByRole("button", { name: "切换到上一个分支" }));
    await act(async () => {
      await Promise.resolve();
    });
    // Prev targets the sibling branch's own anchor (u1), not the active one.
    expect(switchBranchAtAnchor).toHaveBeenCalledWith("u1", -1);
  });

  it("disables the switcher while streaming", () => {
    bridgeState = forkedState({ status: "prompting" });
    const view = renderWorkspace();
    const prev = view.getByRole("button", { name: "切换到上一个分支" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(prev);
    expect(switchBranchAtAnchor).not.toHaveBeenCalled();
  });

  it("cancels an in-progress edit before switching branches", async () => {
    const view = renderWorkspace();
    fireEvent.click(view.getByRole("button", { name: "编辑" }));
    expect(view.getByRole("button", { name: "保存" })).toBeTruthy();

    // Editing disables prev via isStreaming? No — editing alone does not stream.
    // The switcher stays interactive and the click must first cancel the edit.
    fireEvent.click(view.getByRole("button", { name: "切换到上一个分支" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(switchBranchAtAnchor).toHaveBeenCalledWith("u1", -1);
    // The edit UI is gone (not a save — the edit was cancelled).
    expect(view.queryByRole("button", { name: "保存" })).toBeNull();
    expect(editPrompt).not.toHaveBeenCalled();
  });
});
