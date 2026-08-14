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
  it("offers highlight then ask-agent", () => {
    const onHighlight = vi.fn();
    const onAskAgent = vi.fn();
    const { getByText, getAllByRole } = render(
      <SelectionToolbar x={10} y={20} onHighlight={onHighlight} onAskAgent={onAskAgent} />,
    );
    const buttons = getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["高亮", "问 agent"]);
    fireEvent.click(getByText("高亮"));
    fireEvent.click(getByText("问 agent"));
    expect(onHighlight).toHaveBeenCalledOnce();
    expect(onAskAgent).toHaveBeenCalledOnce();
  });
});
