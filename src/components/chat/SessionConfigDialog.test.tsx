// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionConfigDialog } from "./SessionConfigDialog";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderDialog(overrides: {
  open?: boolean;
  session?: { id: string; title: string; systemPrompt?: string; thinkingLevel?: string } | null;
  isStreaming?: boolean;
} = {}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const view = render(
    <SessionConfigDialog
      open={overrides.open ?? true}
      session={overrides.session ?? { id: "session-1", title: "古文翻译" }}
      isStreaming={overrides.isStreaming ?? false}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { view, onClose, onSave };
}

describe("SessionConfigDialog", () => {
  it("prefills the textarea and thinking level from the session config", () => {
    const { view } = renderDialog({
      session: { id: "session-1", title: "古文翻译", systemPrompt: "你是古文翻译助手", thinkingLevel: "high" },
    });
    const dialog = view.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toBe("你是古文翻译助手");
    expect(within(dialog).getByRole("combobox").textContent).toContain("high");
  });

  it("defaults to empty prompt and off level when the session has no config", () => {
    const { view } = renderDialog();
    const dialog = view.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toBe("");
    expect(within(dialog).getByRole("combobox").textContent).toContain("off");
  });

  it("clears the prompt draft when the clear button is clicked", () => {
    const { view } = renderDialog({
      session: { id: "session-1", title: "古文翻译", systemPrompt: "你是古文翻译助手", thinkingLevel: "off" },
    });
    const dialog = view.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    fireEvent.click(within(dialog).getByRole("button", { name: "清空" }));
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("calls onSave with draft values", () => {
    const { view, onSave } = renderDialog();
    const dialog = view.getByRole("dialog");
    const textarea = within(dialog).getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "你是翻译助手" } });

    act(() => {
      within(dialog).getByRole("button", { name: "保存" }).click();
    });

    expect(onSave).toHaveBeenCalledWith("你是翻译助手", "off");
  });

  it("disables save and inputs while streaming", () => {
    const { view, onSave } = renderDialog({ isStreaming: true });
    const dialog = view.getByRole("dialog");
    expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect((within(dialog).getByRole("combobox") as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => {
      within(dialog).getByRole("button", { name: "保存" }).click();
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("closes via the close button", () => {
    const { view, onClose } = renderDialog();
    const dialog = view.getByRole("dialog");
    act(() => {
      within(dialog).getByRole("button", { name: "取消" }).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
