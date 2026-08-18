// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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
});
