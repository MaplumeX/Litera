// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { ChatOutlineRail, userMessagePreview } from "./ChatOutlineRail";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const items = [
  { messageIndex: 0, preview: "第一问" },
  { messageIndex: 2, preview: "第二问" },
];

describe("userMessagePreview", () => {
  it("collapses whitespace and truncates long messages", () => {
    expect(userMessagePreview("  第一行\n\n 第二行  ")).toBe("第一行 第二行");
    expect(userMessagePreview("123456789", 6)).toBe("12345…");
  });
});

describe("ChatOutlineRail", () => {
  it("hides when there are fewer than two user questions", () => {
    const view = render(
      <ChatOutlineRail
        items={[{ messageIndex: 0, preview: "仅一条" }]}
        activeMessageIndex={0}
        onGoTo={() => {}}
      />,
    );
    expect(view.queryByTestId("chat-outline-rail")).toBeNull();
  });

  it("highlights and jumps from the current keyboard-accessible tick", () => {
    const onGoTo = vi.fn();
    const view = render(
      <ChatOutlineRail items={items} activeMessageIndex={2} onGoTo={onGoTo} />,
    );
    const current = view.getByRole("button", { name: "跳转到第 2 条提问：第二问" });
    expect(current.getAttribute("aria-current")).toBe("location");
    fireEvent.click(current);
    expect(onGoTo).toHaveBeenCalledWith(2);
    expect(view.getByTestId("chat-outline-rail")).toBeTruthy();
  });

  it("shows a delayed hover preview, then switches immediately along the rail", () => {
    vi.useFakeTimers();
    const view = render(
      <ChatOutlineRail items={items} activeMessageIndex={0} onGoTo={() => {}} />,
    );
    const rail = view.getByTestId("chat-outline-rail");
    fireEvent.pointerEnter(rail, { clientX: 8, clientY: 20 });
    fireEvent.pointerEnter(view.getByTestId("chat-outline-slot-0"));
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(view.getByTestId("chat-outline-preview").textContent).toBe("第一问");
    expect(view.getByTestId("chat-outline-preview").className).not.toMatch(/shadow-/);
    expect(view.getByText("第一问").className).toContain("line-clamp-2");

    fireEvent.pointerEnter(view.getByTestId("chat-outline-slot-2"));
    expect(view.getByTestId("chat-outline-preview").textContent).toBe("第二问");

    fireEvent.pointerLeave(rail);
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();
  });

  it("shows the focused tick preview and clears it on blur", () => {
    const view = render(
      <ChatOutlineRail items={items} activeMessageIndex={0} onGoTo={() => {}} />,
    );
    const tick = view.getByRole("button", { name: "跳转到第 1 条提问：第一问" });
    fireEvent.focus(tick);
    expect(view.getByTestId("chat-outline-preview").textContent).toBe("第一问");
    fireEvent.blur(tick);
    expect(view.queryByTestId("chat-outline-preview")).toBeNull();
  });

  it("uses English accessible names when the locale is en", () => {
    setLocale("en");
    const view = render(
      <ChatOutlineRail items={items} activeMessageIndex={0} onGoTo={() => {}} />,
    );
    expect(view.getByRole("navigation", { name: "Conversation outline" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Jump to question 1: 第一问" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "Close conversation outline" })).toBeNull();
  });
});
