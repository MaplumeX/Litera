// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolCallCard } from "./ToolCallCard";

// markmap internals are third-party detail: the card tests observe the
// collapsed/expanded shape, not the rendered SVG.
vi.mock("markmap-lib", () => ({
  Transformer: class {
    transform(outline: string) {
      return { root: { content: outline, children: [] }, frontmatter: undefined };
    }
  },
}));
vi.mock("markmap-view", () => ({
  Markmap: { create: vi.fn(() => ({ fit: vi.fn() })) },
  deriveOptions: () => ({}),
  globalCSS: "",
}));

afterEach(() => {
  cleanup();
});

const OUTLINE = "## Main idea\n- point one\n  - detail\n- point two";

function makeMindmapCall(overrides: Partial<Parameters<typeof ToolCallCard>[0]["call"]> = {}) {
  return {
    toolCallId: "mm1",
    tool: "draw_mindmap",
    params: { title: "Chapter 3 structure", outline: OUTLINE },
    done: true,
    result: JSON.stringify({ status: "drawn", title: "Chapter 3 structure", nodes: 4 }),
    ...overrides,
  };
}

describe("MindmapCard (via ToolCallCard)", () => {
  it("renders collapsed by default with the tool name and title only", () => {
    const { container, getByRole } = render(<ToolCallCard call={makeMindmapCall()} />);
    const button = getByRole("button", { name: /draw_mindmap/ });
    expect(button.textContent).toContain("Chapter 3 structure");
    // The outline is the map payload, not collapsed-row summary text.
    expect(button.textContent).not.toContain("point one");
    expect(container.querySelector(".mindmap-canvas")).toBeNull();
  });

  it("expands on click to reveal the map container and the SVG export affordance", () => {
    const { container, getByRole } = render(<ToolCallCard call={makeMindmapCall()} />);
    fireEvent.click(getByRole("button", { name: /draw_mindmap/ }));
    expect(container.querySelector(".mindmap-canvas")).toBeTruthy();
    expect(getByRole("button", { name: "导出 SVG" })).toBeTruthy();
  });

  it("returns to collapsed on a second click", () => {
    const { container, getByRole } = render(<ToolCallCard call={makeMindmapCall()} />);
    const button = getByRole("button", { name: /draw_mindmap/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(container.querySelector(".mindmap-canvas")).toBeNull();
  });

  it("reuses the destructive styling path for error results", () => {
    const { container, getByRole, getByText } = render(
      <ToolCallCard
        call={makeMindmapCall({
          result: "Mind map outline reaches depth 5, exceeding the limit of 4 levels",
          isError: true,
        })}
      />,
    );
    expect(getByText("调用失败")).toBeTruthy();
    expect(container.querySelector(".text-destructive")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /draw_mindmap/ }));
    // The validation error is shown; the broken outline is not rendered as a map.
    expect(container.querySelector(".mindmap-canvas")).toBeNull();
    expect(getByText(/exceeding the limit of 4 levels/)).toBeTruthy();
  });

  it("shows a spinner while the tool call is running", () => {
    const { container, getByRole } = render(
      <ToolCallCard call={makeMindmapCall({ done: false, result: undefined })} />,
    );
    expect(getByRole("button", { name: /draw_mindmap/ }).textContent).toContain(
      "Chapter 3 structure",
    );
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("switches to English labels", async () => {
    const { setLocale } = await import("@/lib/i18n");
    setLocale("en");
    const { getByRole, unmount } = render(<ToolCallCard call={makeMindmapCall()} />);
    fireEvent.click(getByRole("button", { name: /draw_mindmap/ }));
    expect(getByRole("button", { name: "Export SVG" })).toBeTruthy();
    unmount();
    setLocale("zh-CN");
  });
});
