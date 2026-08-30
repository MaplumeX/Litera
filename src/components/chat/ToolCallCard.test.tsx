// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolCallCard } from "./ToolCallCard";

afterEach(() => {
  cleanup();
});

function makeCall(overrides: Partial<Parameters<typeof ToolCallCard>[0]["call"]> = {}) {
  return {
    toolCallId: "t1",
    tool: "read_chapter",
    params: { chapter: "ch1.xhtml", query: "主题" },
    done: true,
    result: "章节内容",
    ...overrides,
  };
}

describe("ToolCallCard", () => {
  it("shows a spinning loader while running", () => {
    const { container, getByText } = render(
      <ToolCallCard call={makeCall({ done: false, result: undefined })} />,
    );
    expect(getByText("read_chapter")).toBeTruthy();
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
    expect(spinner?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("shows a check icon for success", () => {
    const { container } = render(<ToolCallCard call={makeCall()} />);
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(container.textContent).not.toContain("调用失败");
  });

  it("renders destructive styling and label for errors", () => {
    const { container, getByText } = render(
      <ToolCallCard
        call={makeCall({ result: "boom", isError: true })}
      />,
    );
    expect(getByText("调用失败")).toBeTruthy();
    expect(container.querySelector(".text-destructive")).toBeTruthy();
    expect(container.querySelector(".border-destructive\\/50")).toBeTruthy();
  });

  it("expands to key-value params and a result with a copy button", () => {
    const { getByRole, getByText } = render(<ToolCallCard call={makeCall()} />);
    fireEvent.click(getByRole("button", { name: /read_chapter/ }));
    expect(getByText("参数")).toBeTruthy();
    expect(getByText("chapter")).toBeTruthy();
    expect(getByText("ch1.xhtml")).toBeTruthy();
    expect(getByText("结果")).toBeTruthy();
    expect(getByText("章节内容")).toBeTruthy();
    expect(getByRole("button", { name: "复制结果" })).toBeTruthy();
  });

  it("shows params summary in the collapsed row", () => {
    const { getByRole } = render(<ToolCallCard call={makeCall()} />);
    const button = getByRole("button", { name: /read_chapter/ });
    expect(button.textContent).toContain("chapter: ch1.xhtml");
    expect(button.textContent).toContain("query: 主题");
  });

  it("truncates long results with a labeled notice", () => {
    const long = "a".repeat(3000);
    const { getByRole, getByText } = render(<ToolCallCard call={makeCall({ result: long })} />);
    fireEvent.click(getByRole("button", { name: /read_chapter/ }));
    expect(getByText("已截断，共 3000 字符")).toBeTruthy();
    const pre = getByRole("button", { name: /read_chapter/ }).parentElement?.querySelector("pre");
    expect(pre?.textContent?.length).toBe(2000);
  });

  it("falls back to string params when params is not a plain object", () => {
    const { getByRole } = render(
      <ToolCallCard call={makeCall({ params: "raw-input" })} />,
    );
    expect(getByRole("button", { name: /read_chapter/ }).textContent).toContain("raw-input");
  });

  it("switches to English labels", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("en");
    const { getByText, unmount } = render(
      <ToolCallCard
        call={makeCall({ result: "boom", isError: true })}
      />,
    );
    expect(getByText("Failed")).toBeTruthy();
    unmount();
    setLocale("zh-CN");
  });
});
