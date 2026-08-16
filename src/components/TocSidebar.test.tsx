// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocItem } from "@/components/ReaderView";
import { TocSidebar } from "@/components/TocSidebar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const toc: TocItem[] = [
  {
    href: "p1",
    label: "第一部分",
    subitems: [{ href: "c1", label: "第一章" }],
  },
  { href: "c2", label: "第二章" },
];

const LIST = { top: 0, bottom: 400 };
const IN_VIEW = { top: 120, bottom: 152 };
const BELOW = { top: 700, bottom: 732 };
const CLIPPED = { top: 380, bottom: 420 };

function mockRect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 200,
    bottom,
    width: 200,
    height: bottom - top,
    toJSON() {
      return {};
    },
  };
}

function mockGeometry(rows: Record<string, { top: number; bottom: number }>) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function mockGetBoundingClientRect(this: HTMLElement) {
      if (this.classList.contains("overflow-y-auto")) {
        return mockRect(LIST.top, LIST.bottom);
      }
      const label = this.textContent ?? "";
      const row = rows[label];
      return row ? mockRect(row.top, row.bottom) : mockRect(0, 0);
    },
  );
}

function listOf(row: HTMLElement): HTMLElement {
  const list = row.parentElement;
  if (!list) throw new Error("expected TOC list container");
  return list;
}

function centerDelta(row: { top: number; bottom: number }): number {
  return (row.top + row.bottom - LIST.top - LIST.bottom) / 2;
}

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

  it("centers an out-of-view matching row on mount", () => {
    mockGeometry({ 第一章: BELOW });
    const { getByText } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    expect(listOf(getByText("第一章")).scrollTop).toBe(centerDelta(BELOW));
  });

  it("does not scroll when the matching row is fully in view on mount", () => {
    mockGeometry({ 第一章: IN_VIEW });
    const { getByText } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    expect(listOf(getByText("第一章")).scrollTop).toBe(0);
  });

  it("centers the new matching row when currentHref changes out of view", () => {
    mockGeometry({ 第一章: IN_VIEW, 第二章: CLIPPED });
    const { getByText, rerender } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    const list = listOf(getByText("第一章"));
    expect(list.scrollTop).toBe(0);
    rerender(<TocSidebar toc={toc} currentHref="c2" onGoTo={() => {}} />);
    expect(list.scrollTop).toBe(centerDelta(CLIPPED));
  });

  it("does not scroll when the new matching row is fully in view", () => {
    mockGeometry({ 第一章: IN_VIEW, 第二章: { top: 200, bottom: 232 } });
    const { getByText, rerender } = render(
      <TocSidebar toc={toc} currentHref="c1" onGoTo={() => {}} />,
    );
    const list = listOf(getByText("第一章"));
    list.scrollTop = 80;
    rerender(<TocSidebar toc={toc} currentHref="c2" onGoTo={() => {}} />);
    expect(list.scrollTop).toBe(80);
  });

  it("does not scroll when currentHref is missing or matches nothing", () => {
    mockGeometry({ 第一章: BELOW, 第二章: BELOW });
    const { getByText, rerender } = render(
      <TocSidebar toc={toc} onGoTo={() => {}} />,
    );
    const list = listOf(getByText("第一章"));
    expect(list.scrollTop).toBe(0);
    rerender(<TocSidebar toc={toc} currentHref="missing" onGoTo={() => {}} />);
    expect(list.scrollTop).toBe(0);
  });
});
