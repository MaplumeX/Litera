// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantMessage, normalizeLatexDelimiters } from "./AssistantMessage";

afterEach(() => {
  cleanup();
});

const SAMPLE = [
  "# Heading 1",
  "",
  "## Heading 2",
  "",
  "A **bold** and *italic* sentence.",
  "",
  "- list item",
  "",
  "| Col | Val |",
  "| --- | --- |",
  "| a | 1 |",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "> quote",
  "",
  "See [docs](https://example.com).",
].join("\n");

describe("AssistantMessage", () => {
  it("renders common markdown as structured HTML", () => {
    const { container, getByRole, getByText } = render(
      <AssistantMessage message={{ role: "assistant", content: SAMPLE }} />,
    );

    expect(container.querySelector("h1")?.textContent).toBe("Heading 1");
    expect(container.querySelector("h2")?.textContent).toBe("Heading 2");
    expect(container.querySelector("ul")).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toContain("const x = 1;");
    expect(container.querySelector("blockquote")?.textContent).toContain("quote");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");

    const link = getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(getByText("list item")).toBeTruthy();
  });

  it("renders a collapsed thinking block only when thinking is present", () => {
    const { queryByText } = render(
      <AssistantMessage message={{ role: "assistant", content: "answer" }} />,
    );
    expect(queryByText("思考过程")).toBeNull();

    const second = render(
      <AssistantMessage
        message={{ role: "assistant", content: "answer", blocks: [{ type: "thinking", text: "内部推理" }, { type: "text", text: "answer" }] }}
      />,
    );
    expect(second.getByText("思考过程")).toBeTruthy();
    expect(second.queryByText("内部推理")).toBeNull();

    fireEvent.click(second.getByRole("button", { name: "思考过程" }));
    expect(second.getByText("内部推理")).toBeTruthy();
    expect(second.getByRole("button", { name: "思考过程" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("auto-expands thinking while streaming and collapses after streaming ends", () => {
    const first = render(
      <AssistantMessage
        message={{ role: "assistant", content: "", blocks: [{ type: "thinking", text: "推理中" }] }}
        streaming
      />,
    );
    expect(first.getByText("推理中")).toBeTruthy();

    first.rerender(
      <AssistantMessage
        message={{ role: "assistant", content: "done", blocks: [{ type: "thinking", text: "推理中" }, { type: "text", text: "done" }] }}
        streaming={false}
      />,
    );
    expect(first.queryByText("推理中")).toBeNull();
  });

  it("renders blocks in array order with thinking before an earlier tool card", () => {
    const { container } = render(
      <AssistantMessage
        message={{
          role: "assistant",
          content: "结论",
          blocks: [
            { type: "thinking", text: "先想" },
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "read_chapter", params: {}, done: true, result: "章节" } },
            { type: "text", text: "结论" },
          ],
        }}
      />,
    );
    const children = Array.from(container.querySelectorAll(".space-y-1 > *"));
    expect(children).toHaveLength(3);
    expect(children[0].textContent).toContain("思考过程");
    expect(children[1].textContent).toContain("read_chapter");
    expect(children[2].textContent).toContain("结论");
  });

  it("falls back to rendering content as a single text block when blocks is missing", () => {
    const { container, getByText } = render(
      <AssistantMessage message={{ role: "assistant", content: SAMPLE }} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Heading 1");
    expect(getByText("list item")).toBeTruthy();
  });

  it("renders a stopped marker only on aborted assistant messages", () => {
    const aborted = render(
      <AssistantMessage
        message={{ role: "assistant", content: "回答到一半", stopReason: "aborted" }}
      />,
    );
    expect(aborted.getByText("已停止")).toBeTruthy();
    aborted.unmount();

    const normal = render(
      <AssistantMessage message={{ role: "assistant", content: "完整回答" }} />,
    );
    expect(normal.queryByText("已停止")).toBeNull();
    normal.unmount();
    const errored = render(
      <AssistantMessage
        message={{ role: "assistant", content: "出错了", stopReason: "error" }}
      />,
    );
    expect(errored.queryByText("已停止")).toBeNull();
  });

  it("does not render the stopped marker while streaming", () => {
    const view = render(
      <AssistantMessage
        message={{ role: "assistant", content: "生成中", stopReason: "aborted" }}
        streaming
      />,
    );
    expect(view.queryByText("已停止")).toBeNull();
  });
});

describe("AssistantMessage math rendering", () => {
  it("renders inline math as KaTeX HTML without the raw $...$ source (AC1)", () => {
    const { container } = render(
      <AssistantMessage message={{ role: "assistant", content: "能量 $E=mc^2$ 很有名。" }} />,
    );
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.textContent).not.toContain("$E=mc^2$");
  });

  it("renders block math as a .katex-display with a scrollable container (AC2)", () => {
    const { container } = render(
      <AssistantMessage message={{ role: "assistant", content: "公式：\n\n$$\\int_0^1 x\\,dx$$" }} />,
    );
    const display = container.querySelector(".katex-display");
    expect(display).toBeTruthy();
    const scrollable = display?.closest(".overflow-x-auto");
    expect(scrollable).toBeTruthy();
  });

  it("does not throw on unclosed streaming fragments (AC3)", () => {
    expect(() =>
      render(<AssistantMessage message={{ role: "assistant", content: "计算 $\\frac{" }} streaming />),
    ).not.toThrow();

    const closedButBroken = render(
      <AssistantMessage message={{ role: "assistant", content: "结果 $\\frac{$ 有问题。" }} />,
    );
    expect(closedButBroken.container.textContent).toContain("\\frac{");
  });

  it("renders an error placeholder for invalid LaTeX instead of a blank message (AC4)", () => {
    const { container } = render(
      <AssistantMessage message={{ role: "assistant", content: "坏的公式 $\\invalidcmd{$ 演示。" }} />,
    );
    expect(container.querySelector(".katex-error")).toBeTruthy();
    // 整条消息其余部分仍然渲染
    expect(container.textContent).toContain("坏的公式");
    expect(container.textContent).toContain("演示。");
  });

  it("rewrites \\[...] and \$$...\$$ delimiters outside code spans", () => {
    const text = "行内 \\(E=mc^2\\) 与块级\n\n\\[\\int_0^1 x\\,dx\\]";
    const { container } = render(
      <AssistantMessage message={{ role: "assistant", content: text }} />,
    );
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });
});

describe("normalizeLatexDelimiters", () => {
  it("leaves fenced code blocks untouched", () => {
    const input = ["前文 \\[x\\] 后文", "", "```ts", 'const s = "\\[x\\]";', "```"].join("\n");
    const output = normalizeLatexDelimiters(input);
    expect(output).toContain('const s = "\\[x\\]";');
  });

  it("leaves inline code untouched and rewrites prose", () => {
    const output = normalizeLatexDelimiters("`\\(x\\)` 外 \\(x\\)");
    expect(output).toBe("`\\(x\\)` 外 $x$");
  });
});
