// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "./AssistantMessage";
import type { AgentToolCall } from "@/types/agent";

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

  it("clicks a search hit row and emits a chapter citation", () => {
    const onOpenCitation = vi.fn();
    const call: AgentToolCall = {
      toolCallId: "search-1",
      tool: "search_in_book",
      params: { queries: ["Ishmael"] },
      result: JSON.stringify([
        { chapterIndex: 2, chapterTitle: "Loomings", snippet: "Call me Ishmael." },
      ]),
      done: true,
    };
    const { getByRole } = render(
      <AssistantMessage
        message={{ role: "assistant", content: "found it", toolCalls: [call] }}
        onOpenCitation={onOpenCitation}
      />,
    );

    fireEvent.click(getByRole("button", { name: "打开章节：Loomings" }));
    expect(onOpenCitation).toHaveBeenCalledWith({ kind: "chapter", chapterIndex: 2 });
  });

  it("clicks a highlight row and emits a cfi citation", () => {
    const onOpenCitation = vi.fn();
    const call: AgentToolCall = {
      toolCallId: "ann-1",
      tool: "list_annotations",
      params: {},
      result: JSON.stringify({
        bookmarks: [],
        highlights: [
          { id: "h1", cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)", excerpt: "Call me Ishmael." },
        ],
      }),
      done: true,
    };
    const { getByRole } = render(
      <AssistantMessage
        message={{ role: "assistant", content: "your marks", toolCalls: [call] }}
        onOpenCitation={onOpenCitation}
      />,
    );

    fireEvent.click(getByRole("button", { name: "打开标注：Call me Ishmael." }));
    expect(onOpenCitation).toHaveBeenCalledWith({
      kind: "cfi",
      cfi: "epubcfi(/6/8!/4/2,/1:12,/1:48)",
    });
  });

  it("does not render citation rows for isError tool results", () => {
    const onOpenCitation = vi.fn();
    const call: AgentToolCall = {
      toolCallId: "read-1",
      tool: "read_chapter",
      params: { chapterIndex: 2 },
      result: "Failed to read chapter",
      done: true,
      isError: true,
    };
    const { queryByRole } = render(
      <AssistantMessage
        message={{ role: "assistant", content: "could not read", toolCalls: [call] }}
        onOpenCitation={onOpenCitation}
      />,
    );

    expect(queryByRole("button", { name: /打开章节/ })).toBeNull();
    expect(onOpenCitation).not.toHaveBeenCalled();
  });
});
