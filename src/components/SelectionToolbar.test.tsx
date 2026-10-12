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
  it("offers one-click color highlights then ask-agent", () => {
    const onHighlight = vi.fn();
    const onAskAgent = vi.fn();
    const { getByLabelText, getByText, getAllByRole } = render(
      <SelectionToolbar
        x={10}
        y={20}
        lastColor="yellow"
        onHighlight={onHighlight}
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
      "问 agent",
    ]);
    fireEvent.click(getByLabelText("用蓝色高亮"));
    fireEvent.click(getByText("问 agent"));
    expect(onHighlight).toHaveBeenCalledWith("blue");
    expect(onAskAgent).toHaveBeenCalledOnce();
  });
});
