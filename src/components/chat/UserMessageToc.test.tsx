// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { UserMessageToc, userMessagePreview } from "./UserMessageToc";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  vi.restoreAllMocks();
});

describe("userMessagePreview", () => {
  it("collapses whitespace and truncates long messages", () => {
    expect(userMessagePreview("  第一行\n\n 第二行  ")).toBe("第一行 第二行");
    expect(userMessagePreview("123456789", 6)).toBe("12345…");
  });
});

describe("UserMessageToc", () => {
  const items = [
    { messageIndex: 0, preview: "第一问" },
    { messageIndex: 2, preview: "第二问" },
  ];

  it("highlights and jumps from the current keyboard-accessible item", () => {
    const onGoTo = vi.fn();
    const view = render(
      <UserMessageToc
        items={items}
        activeMessageIndex={2}
        onGoTo={onGoTo}
        onClose={() => {}}
      />,
    );
    const current = view.getByRole("button", { name: "跳转到第 2 条提问：第二问" });
    expect(current.getAttribute("aria-current")).toBe("location");
    fireEvent.click(current);
    expect(onGoTo).toHaveBeenCalledWith(2);
  });

  it("closes from Escape and the explicit close button", () => {
    const onClose = vi.fn();
    const view = render(
      <UserMessageToc
        items={items}
        activeMessageIndex={0}
        onGoTo={() => {}}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(view.getAllByRole("button", { name: "关闭对话目录" })[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("uses English accessible names when the locale is en", () => {
    setLocale("en");
    const view = render(
      <UserMessageToc
        items={items}
        activeMessageIndex={0}
        onGoTo={() => {}}
        onClose={() => {}}
      />,
    );
    expect(view.getByRole("complementary", { name: "Conversation outline" })).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Close conversation outline" })).toHaveLength(2);
    expect(view.getByRole("button", { name: "Jump to question 1: 第一问" })).toBeTruthy();
  });

  it("only recenters the current row after it leaves the list viewport", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getRect(this: HTMLElement) {
        const text = this.textContent ?? "";
        if (this.classList.contains("overflow-y-auto")) return rect(0, 300);
        if (text.includes("第二问")) return rect(500, 540);
        return rect(100, 140);
      },
    );
    const view = render(
      <UserMessageToc
        items={items}
        activeMessageIndex={0}
        onGoTo={() => {}}
        onClose={() => {}}
      />,
    );
    const list = view.getByText("第一问").closest("div.overflow-y-auto") as HTMLDivElement;
    list.scrollTop = 25;
    view.rerender(
      <UserMessageToc
        items={items}
        activeMessageIndex={2}
        onGoTo={() => {}}
        onClose={() => {}}
      />,
    );
    expect(list.scrollTop).toBe(395);
  });
});

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom,
    width: 200,
    height: bottom - top,
    toJSON: () => ({}),
  };
}
