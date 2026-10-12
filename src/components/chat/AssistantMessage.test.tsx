// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QuoteLocation } from "@/agent/book/book-content";
import { AssistantMessage, normalizeLatexDelimiters } from "./AssistantMessage";
import { CitationContext } from "./Citation";

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

  it("hides the thinking block's own scrollbar and follows the stream tail while streaming", () => {
    const { container, rerender } = render(
      <AssistantMessage
        message={{ role: "assistant", content: "", blocks: [{ type: "thinking", text: "第一段" }] }}
        streaming
      />,
    );
    const body = container.querySelector(".chat-thinking-body") as HTMLDivElement;
    expect(body).toBeTruthy();

    // 滚动条隐藏靠 CSS（jsdom 不算样式）；行为层面验证的是：内容增长时容器贴底。
    let scrolledTo = -1;
    Object.defineProperty(body, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(body, "clientHeight", { value: 240, configurable: true });
    Object.defineProperty(body, "scrollTop", {
      get: () => scrolledTo,
      set: (value: number) => {
        scrolledTo = value;
      },
      configurable: true,
    });

    rerender(
      <AssistantMessage
        message={{ role: "assistant", content: "", blocks: [{ type: "thinking", text: "第一段\n第二段很长" }] }}
        streaming
      />,
    );
    expect(scrolledTo).toBe(300);
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
    expect(children[1].getAttribute("data-testid")).toBe("source-summary");
    expect(children[2].textContent).toContain("结论");
  });

  it("folds book tool calls into one source summary where the first one sits", () => {
    const read = (part: number) =>
      JSON.stringify({ chapterIndex: 2, chapterNumber: 3, chapterTitle: "第三章 归来", part, totalParts: 3, text: "..." });
    const { container, getByTestId, getByText, queryByText, getByRole } = render(
      <AssistantMessage
        message={{
          role: "assistant",
          content: "前言结论",
          blocks: [
            { type: "text", text: "前言" },
            { type: "toolCall", toolCall: { toolCallId: "t1", tool: "read_chapter", params: { chapterIndex: 2 }, done: true, result: read(0) } },
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "search_in_book", params: { queries: ["归来"] }, done: true, result: JSON.stringify([{}, {}]) } },
            { type: "toolCall", toolCall: { toolCallId: "t3", tool: "read_chapter", params: { chapterIndex: 2, part: 1 }, done: true, result: read(1) } },
            { type: "text", text: "结论" },
          ],
        }}
      />,
    );
    const children = Array.from(container.querySelectorAll(".space-y-1 > *"));
    expect(children).toHaveLength(3);
    expect(children[1]).toBe(getByTestId("source-summary"));
    expect(getByText("第三章 归来（读了 2/3 段）")).toBeTruthy();
    expect(getByText("搜索 1 次，命中 2 处")).toBeTruthy();
    expect(getByRole("img", { name: "部分章节未读完，回答可能不完整" })).toBeTruthy();
    expect(queryByText("read_chapter")).toBeNull();

    fireEvent.click(getByTestId("source-summary").querySelector("button")!);
    expect(container.querySelectorAll('[data-testid="source-summary"] [aria-expanded]').length).toBe(4);
    expect(getByText("search_in_book")).toBeTruthy();
  });

  it("shows a fully read chapter without a partial warning and keeps mind maps separate", () => {
    const { getByText, queryByRole } = render(
      <AssistantMessage
        message={{
          role: "assistant",
          content: "",
          blocks: [
            {
              type: "toolCall",
              toolCall: {
                toolCallId: "t1",
                tool: "read_chapter",
                params: {},
                done: true,
                result: JSON.stringify({ chapterIndex: 0, chapterNumber: 1, chapterTitle: "序", part: 0, totalParts: 1, text: "" }),
              },
            },
            { type: "toolCall", toolCall: { toolCallId: "t2", tool: "draw_mindmap", params: { title: "图", outline: "# 图" }, done: true, result: "{}" } },
          ],
        }}
      />,
    );
    expect(getByText("序")).toBeTruthy();
    expect(queryByRole("img", { name: "部分章节未读完，回答可能不完整" })).toBeNull();
    expect(getByText("draw_mindmap")).toBeTruthy();
  });

  it("renders no source summary for answers without book tools", () => {
    const { queryByTestId } = render(
      <AssistantMessage message={{ role: "assistant", content: "直接回答" }} />,
    );
    expect(queryByTestId("source-summary")).toBeNull();
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

describe("AssistantMessage citations", () => {
  const verified: QuoteLocation = {
    status: "verified",
    chapterIndex: 2,
    chapterTitle: "第三章 归来",
    href: "c.xhtml",
    passage: "他说：自由不是没有约束。然后离开了。",
    matchStart: 3,
    matchEnd: 12,
  };
  const content = "作者写道[“自由不是没有约束”](cite:2)，见[官网](https://example.com)。";

  function renderWith(locate: (chapterIndex: number, quote: string) => Promise<QuoteLocation>, streaming = false) {
    const openInBook = vi.fn();
    const screen = render(
      <CitationContext.Provider value={{ locate, openInBook }}>
        <AssistantMessage message={{ role: "assistant", content }} streaming={streaming} />
      </CitationContext.Provider>,
    );
    return { ...screen, openInBook };
  }

  it("renders cite: links as citations and leaves other links alone", async () => {
    const locate = vi.fn(async () => verified);
    const { getByRole, container } = renderWith(locate);
    const citation = getByRole("button", { name: "“自由不是没有约束”" });
    expect(citation.tagName).toBe("BUTTON");
    expect(container.querySelector('a[href="https://example.com"]')).toBeTruthy();
    expect(container.querySelector('a[href^="cite:"]')).toBeNull();
    await waitFor(() => expect(citation.getAttribute("data-citation")).toBe("verified"));
    expect(locate).toHaveBeenCalledWith(2, "“自由不是没有约束”");
  });

  it("does not check citations while the text is streaming", () => {
    const locate = vi.fn(async () => verified);
    renderWith(locate, true);
    expect(locate).not.toHaveBeenCalled();
  });

  it("opens the passage with the quote emphasised and offers Open in Book", async () => {
    const { getByRole, findByText, openInBook } = renderWith(async () => verified);
    const citation = getByRole("button", { name: "“自由不是没有约束”" });
    await waitFor(() => expect(citation.getAttribute("data-citation")).toBe("verified"));
    await act(async () => {
      fireEvent.click(citation);
    });
    expect(await findByText("第三章 归来")).toBeTruthy();
    expect(document.querySelector("mark")?.textContent).toBe("自由不是没有约束。");
    fireEvent.click(getByRole("button", { name: "在书中打开" }));
    expect(openInBook).toHaveBeenCalledWith(verified, "“自由不是没有约束”");
  });

  it("marks unverified citations and hides Open in Book for them", async () => {
    const { getByRole, getByLabelText, findByText, queryByRole } = renderWith(async () => ({
      status: "unverified",
      chapterIndex: 2,
    }));
    await waitFor(() => expect(getByLabelText("未在书中找到此引文")).toBeTruthy());
    await act(async () => {
      fireEvent.click(getByRole("button", { name: /自由不是没有约束/ }));
    });
    expect(await findByText(/它可能被改写过/)).toBeTruthy();
    expect(queryByRole("button", { name: "在书中打开" })).toBeNull();
  });

  it("explains relocated citations", async () => {
    const { getByRole, findByText } = renderWith(async () => ({ ...verified, status: "relocated", chapterIndex: 5 }));
    const citation = getByRole("button", { name: "“自由不是没有约束”" });
    await waitFor(() => expect(citation.getAttribute("data-citation")).toBe("relocated"));
    await act(async () => {
      fireEvent.click(citation);
    });
    expect(await findByText(/与回答标注的章节不同/)).toBeTruthy();
  });
});
