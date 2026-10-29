// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { SelectionToolbar } from "./SelectionToolbar";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
});

describe("SelectionToolbar", () => {
  it("offers one-click color highlights, copy, then ask-agent", () => {
    const onHighlight = vi.fn();
    const onCopy = vi.fn();
    const onAskAgent = vi.fn();
    const { getByLabelText, getByText, getAllByRole } = render(
      <SelectionToolbar
        x={10}
        y={20}
        lastColor="yellow"
        onHighlight={onHighlight}
        onCopy={onCopy}
        onAskAgent={onAskAgent}
      />,
    );
    const buttons = getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "用黄色高亮",
      "用绿色高亮",
      "用蓝色高亮",
      "用粉色高亮",
      "用橙色高亮",
      "复制",
      "问 agent",
    ]);
    fireEvent.click(getByLabelText("用蓝色高亮"));
    fireEvent.click(getByLabelText("复制"));
    fireEvent.click(getByText("问 agent"));
    expect(onHighlight).toHaveBeenCalledWith("blue");
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onAskAgent).toHaveBeenCalledOnce();
  });

  it("offers guiding up to the selection only when asked to", () => {
    const onGuideTo = vi.fn();
    const props = { x: 10, y: 20, lastColor: "yellow" as const, onHighlight: vi.fn(), onCopy: vi.fn(), onAskAgent: vi.fn() };
    const view = render(<SelectionToolbar {...props} />);
    expect(view.queryByLabelText("带读到这里")).toBeNull();
    view.rerender(<SelectionToolbar {...props} onGuideTo={onGuideTo} />);
    fireEvent.click(view.getByLabelText("带读到这里"));
    expect(onGuideTo).toHaveBeenCalledOnce();
  });
});
