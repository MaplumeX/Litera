// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput, type PendingSelection } from "./ChatInput";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

function baseProps(overrides: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  return {
    value: "",
    onChange: vi.fn(),
    onSend: vi.fn(),
    onAbort: vi.fn(),
    isStreaming: false,
    bookReady: true,
    pendingSelection: null as PendingSelection | null,
    onClearSelection: vi.fn(),
    retryHighlight: false,
    textareaRef: { current: null },
    thinkingLevel: "medium",
    onThinkingLevelChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ChatInput leadingControls", () => {
  it("renders leadingControls at the left of the toolbar row", () => {
    const view = render(
      <ChatInput {...baseProps()} leadingControls={<button type="button">模型开关</button>} />,
    );
    expect(view.getByRole("button", { name: "模型开关" })).toBeTruthy();
    const trigger = view.getByText("模型开关").closest("button") as HTMLElement;
    const toolbar = trigger.parentElement as HTMLElement;
    expect(toolbar.textContent?.indexOf("模型开关")).toBe(0);
    expect(toolbar.textContent).toContain("medium");
  });

  it("renders without leadingControls", () => {
    const view = render(<ChatInput {...baseProps()} />);
    expect(view.getByText("medium")).toBeTruthy();
  });
});
