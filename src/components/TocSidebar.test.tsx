// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TocItem } from "@/components/ReaderView";
import { TocSidebar } from "@/components/TocSidebar";

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

afterEach(() => {
  cleanup();
});

const toc: TocItem[] = [
  {
    href: "p1",
    label: "第一部分",
    subitems: [{ href: "c1", label: "第一章" }],
  },
  { href: "c2", label: "第二章" },
];

describe("TocSidebar", () => {
  it("uses a title row as dense as the window header", () => {
    const { getByText } = render(
      <TocSidebar toc={toc} onGoTo={() => {}} />,
    );
    expect(getByText("目录").className).toContain("h-12");
    expect(getByText("目录").className).toContain("px-3");
    expect(getByText("目录").className).not.toContain("py-3");
  });

  it("highlights the current chapter and still jumps from a nested row", () => {
    const onGoTo = vi.fn();
    const { getByText } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={onGoTo} />,
    );
    const current = getByText("第一章");
    expect(current.className).toContain("bg-accent");
    expect(current.className).toContain("font-medium");
    expect(getByText("第二章").className).toContain("text-muted-foreground");
    fireEvent.click(current);
    expect(onGoTo).toHaveBeenCalledWith("c1");
  });

  it("does not mark a row current when the href is missing", () => {
    const { getByText } = render(
      <TocSidebar toc={toc} onGoTo={() => {}} />,
    );
    expect(getByText("第一章").className).not.toContain("font-medium");
    expect(getByText("第二章").className).not.toContain("font-medium");
  });

  it("scrolls the matching row into view on mount", () => {
    const { getByText } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "auto",
    });
    expect(scrollIntoView.mock.contexts[0]).toBe(getByText("第一章"));
  });

  it("scrolls the new matching row when currentHref changes", () => {
    const { getByText, rerender } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    scrollIntoView.mockClear();
    rerender(<TocSidebar toc={toc} currentHref="c2" onGoTo={() => {}} />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      behavior: "auto",
    });
    expect(scrollIntoView.mock.contexts[0]).toBe(getByText("第二章"));
  });

  it("does not scroll when currentHref is missing or matches nothing", () => {
    const { rerender } = render(<TocSidebar toc={toc} onGoTo={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<TocSidebar toc={toc} currentHref="missing" onGoTo={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
