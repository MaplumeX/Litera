// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookSearchPanel } from "@/components/BookSearchPanel";
import { EMPTY_SEARCH_RESULTS, type BookSearchResults } from "@/lib/book-search";

afterEach(cleanup);

const results: BookSearchResults = {
  groups: [
    {
      label: "第一章",
      hits: [
        { cfi: "a", pre: "在", match: "河边", post: "散步" },
        { cfi: "b", pre: "又到", match: "河边", post: "" },
      ],
    },
    { label: "", hits: [{ cfi: "c", pre: "", match: "河边", post: "的树" }] },
  ],
  total: 3,
  progress: 1,
  truncated: false,
};

function hitButton(text: string): HTMLElement {
  const button = screen.getAllByRole("button").find((el) => el.textContent === text);
  if (!button) throw new Error(`no hit ${text}`);
  return button;
}

function renderPanel(overrides: Partial<Parameters<typeof BookSearchPanel>[0]> = {}) {
  const props = {
    query: "河边",
    onQueryChange: vi.fn(),
    onSubmit: vi.fn(),
    onStep: vi.fn(),
    onSelect: vi.fn(),
    onClear: vi.fn(),
    results,
    status: "done" as const,
    activeCfi: null,
    focusToken: 0,
    ...overrides,
  };
  render(<BookSearchPanel {...props} />);
  return props;
}

describe("BookSearchPanel", () => {
  it("lists matches under their chapters with the match marked", () => {
    renderPanel();
    expect(screen.getByText("第一章")).toBeTruthy();
    expect(screen.getByText("未命名章节")).toBeTruthy();
    expect(screen.getAllByText("河边", { selector: "mark" })).toHaveLength(3);
    expect(screen.getByText("共 3 处")).toBeTruthy();
  });

  it("focuses the field on open", () => {
    renderPanel();
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });

  it("shows the position of the current match", () => {
    renderPanel({ activeCfi: "b" });
    expect(screen.getByText("第 2 / 3 处")).toBeTruthy();
    expect(hitButton("又到河边").getAttribute("aria-current")).toBe("true");
  });

  it("submits with Enter and steps back with Shift+Enter", () => {
    const props = renderPanel();
    const field = screen.getByRole("searchbox");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(props.onSubmit).toHaveBeenNthCalledWith(1, 1);
    expect(props.onSubmit).toHaveBeenNthCalledWith(2, -1);
  });

  it("clears with Esc before the panel closes", () => {
    const props = renderPanel();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    window.removeEventListener("keydown", outer);
    expect(props.onClear).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it("jumps to a match and steps with the arrows", () => {
    const props = renderPanel();
    fireEvent.click(hitButton("在河边散步"));
    expect(props.onSelect).toHaveBeenCalledWith(results.groups[0].hits[0]);
    fireEvent.click(screen.getByRole("button", { name: "下一处" }));
    fireEvent.click(screen.getByRole("button", { name: "上一处" }));
    expect(props.onStep).toHaveBeenNthCalledWith(1, 1);
    expect(props.onStep).toHaveBeenNthCalledWith(2, -1);
  });

  it("reports progress, no matches and truncation", () => {
    const { unmount } = render(
      <BookSearchPanel
        query="x"
        onQueryChange={vi.fn()}
        onSubmit={vi.fn()}
        onStep={vi.fn()}
        onSelect={vi.fn()}
        onClear={vi.fn()}
        results={{ ...EMPTY_SEARCH_RESULTS, progress: 0.42 }}
        status="searching"
        activeCfi={null}
        focusToken={0}
      />,
    );
    expect(screen.getByText("搜索中… 42%")).toBeTruthy();
    unmount();
    renderPanel({ results: EMPTY_SEARCH_RESULTS });
    expect(screen.getByText("没有找到匹配的内容")).toBeTruthy();
    cleanup();
    renderPanel({ results: { ...results, truncated: true } });
    expect(screen.getByText("只列出前 3 处，请换个更具体的词。")).toBeTruthy();
  });
});
