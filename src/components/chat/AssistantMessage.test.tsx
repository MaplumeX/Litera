// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantMessage } from "./AssistantMessage";

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
});
