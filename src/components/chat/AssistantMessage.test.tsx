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
      <AssistantMessage message={{ role: "assistant", content: "answer", thinking: "内部推理" }} />,
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
        message={{ role: "assistant", content: "", thinking: "推理中" }}
        streaming
      />,
    );
    expect(first.getByText("推理中")).toBeTruthy();

    first.rerender(
      <AssistantMessage
        message={{ role: "assistant", content: "done", thinking: "推理中" }}
        streaming={false}
      />,
    );
    expect(first.queryByText("推理中")).toBeNull();
  });
});
