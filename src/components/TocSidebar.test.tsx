// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocItem } from "@/components/ReaderView";
import { TocSidebar } from "@/components/TocSidebar";
import { setLocale } from "@/lib/i18n";
import { ancestorKeysForHref, collapsibleKeys } from "@/lib/toc-items";

afterEach(() => {
  cleanup();
  setLocale("zh-CN");
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

const nestedToc: TocItem[] = [
  {
    href: "p1",
    label: "第一部分",
    subitems: [{ href: "c1", label: "第一章" }],
  },
  {
    href: "p2",
    label: "第二部分",
    subitems: [{ href: "c3", label: "第三章" }],
  },
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
  const list = row.closest(".overflow-y-auto");
  if (!list) throw new Error("expected TOC list container");
  return list as HTMLElement;
}

function rowOf(label: HTMLElement): HTMLElement {
  const row = label.parentElement;
  if (!row) throw new Error("expected TOC row");
  return row;
}

function centerDelta(row: { top: number; bottom: number }): number {
  return (row.top + row.bottom - LIST.top - LIST.bottom) / 2;
}

function renderSidebar(
  props: Partial<ComponentProps<typeof TocSidebar>> & { toc?: TocItem[] } = {},
) {
  const tree = props.toc ?? toc;
  return render(
    <TocSidebar
      toc={tree}
      expanded={collapsibleKeys(tree)}
      onToggle={() => {}}
      onExpandAll={() => {}}
      onCollapseAll={() => {}}
      onGoTo={() => {}}
      {...props}
    />,
  );
}

describe("TocSidebar", () => {
  it("uses a title row as dense as the window header", () => {
    const { getByText } = renderSidebar();
    const title = getByText("目录").closest(".h-12");
    expect(title?.className).toContain("h-12");
    expect(title?.className).toContain("px-3");
    expect(title?.className).not.toContain("py-3");
  });

  it("highlights the current chapter and still jumps from a nested row", () => {
    const onGoTo = vi.fn();
    const { getByText } = renderSidebar({ currentHref: "c1", onGoTo });
    const current = rowOf(getByText("第一章"));
    expect(current.className).toContain("bg-accent");
    expect(current.className).toContain("font-medium");
    expect(rowOf(getByText("第二章")).className).toContain("text-muted-foreground");
    fireEvent.click(getByText("第一章"));
    expect(onGoTo).toHaveBeenCalledWith("c1");
  });

  it("does not mark a row current when the href is missing", () => {
    const { getByText } = renderSidebar();
    expect(rowOf(getByText("第一章")).className).not.toContain("font-medium");
    expect(rowOf(getByText("第二章")).className).not.toContain("font-medium");
  });

  it("toggles expand from the chevron without jumping", () => {
    const onGoTo = vi.fn();
    const onToggle = vi.fn();
    const { getByLabelText, queryByText } = renderSidebar({
      expanded: [],
      onGoTo,
      onToggle,
    });
    expect(queryByText("第一章")).toBeNull();
    fireEvent.click(getByLabelText("展开"));
    expect(onToggle).toHaveBeenCalledWith("0");
    expect(onGoTo).not.toHaveBeenCalled();
  });

  it("hides descendants while the parent key is collapsed", () => {
    const { getByText, queryByText } = renderSidebar({ expanded: [] });
    expect(getByText("第一部分")).toBeTruthy();
    expect(queryByText("第一章")).toBeNull();
    expect(getByText("第二章")).toBeTruthy();
  });

  it("does not jump when an empty-href title is clicked", () => {
    const onGoTo = vi.fn();
    const onToggle = vi.fn();
    const emptyParent: TocItem[] = [
      {
        href: "",
        label: "分组",
        subitems: [{ href: "c1", label: "第一章" }],
      },
    ];
    const { getByLabelText, getByText } = renderSidebar({
      toc: emptyParent,
      expanded: ["0"],
      onGoTo,
      onToggle,
    });
    fireEvent.click(getByText("分组"));
    expect(onGoTo).not.toHaveBeenCalled();
    fireEvent.click(getByLabelText("折叠"));
    expect(onToggle).toHaveBeenCalledWith("0");
  });

  it("calls expand-all and collapse-all from the title row", () => {
    const onExpandAll = vi.fn();
    const onCollapseAll = vi.fn();
    const { getByLabelText } = renderSidebar({ onExpandAll, onCollapseAll });
    fireEvent.click(getByLabelText("全部展开"));
    fireEvent.click(getByLabelText("全部折叠"));
    expect(onExpandAll).toHaveBeenCalledTimes(1);
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });

  it("shows only the current chapter path when those ancestors are expanded", () => {
    const { getByText, queryByText } = renderSidebar({
      toc: nestedToc,
      currentHref: "c1",
      expanded: ancestorKeysForHref(nestedToc, "c1"),
    });
    expect(getByText("第一章")).toBeTruthy();
    expect(queryByText("第三章")).toBeNull();
  });

  it("does not put a chevron on leaf rows", () => {
    const { getByText } = renderSidebar();
    expect(within(rowOf(getByText("第二章"))).queryByLabelText("展开")).toBeNull();
    expect(within(rowOf(getByText("第二章"))).queryByLabelText("折叠")).toBeNull();
  });

  it("does not nest buttons", () => {
    const { container } = renderSidebar();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("labels collapse chrome in English", () => {
    setLocale("en");
    const { getByLabelText } = renderSidebar();
    expect(getByLabelText("Expand all")).toBeTruthy();
    expect(getByLabelText("Collapse all")).toBeTruthy();
  });

  it("centers an out-of-view matching row on mount", () => {
    mockGeometry({ 第一章: BELOW });
    const { getByText } = renderSidebar({ currentHref: "c1" });
    expect(listOf(getByText("第一章")).scrollTop).toBe(centerDelta(BELOW));
  });

  it("does not scroll when the matching row is fully in view on mount", () => {
    mockGeometry({ 第一章: IN_VIEW });
    const { getByText } = renderSidebar({ currentHref: "c1" });
    expect(listOf(getByText("第一章")).scrollTop).toBe(0);
  });

  it("centers the new matching row when currentHref changes out of view", () => {
    mockGeometry({ 第一章: IN_VIEW, 第二章: CLIPPED });
    const { getByText, rerender } = renderSidebar({ currentHref: "c1" });
    const list = listOf(getByText("第一章"));
    expect(list.scrollTop).toBe(0);
    rerender(
      <TocSidebar
        toc={toc}
        currentHref="c2"
        expanded={collapsibleKeys(toc)}
        onToggle={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
        onGoTo={() => {}}
      />,
    );
    expect(list.scrollTop).toBe(centerDelta(CLIPPED));
  });

  it("does not scroll when the new matching row is fully in view", () => {
    mockGeometry({ 第一章: IN_VIEW, 第二章: { top: 200, bottom: 232 } });
    const { getByText, rerender } = renderSidebar({ currentHref: "c1" });
    const list = listOf(getByText("第一章"));
    list.scrollTop = 80;
    rerender(
      <TocSidebar
        toc={toc}
        currentHref="c2"
        expanded={collapsibleKeys(toc)}
        onToggle={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
        onGoTo={() => {}}
      />,
    );
    expect(list.scrollTop).toBe(80);
  });

  it("does not scroll when currentHref is missing or matches nothing", () => {
    mockGeometry({ 第一章: BELOW, 第二章: BELOW });
    const { getByText, rerender } = renderSidebar();
    const list = listOf(getByText("第一章"));
    expect(list.scrollTop).toBe(0);
    rerender(
      <TocSidebar
        toc={toc}
        currentHref="missing"
        expanded={collapsibleKeys(toc)}
        onToggle={() => {}}
        onExpandAll={() => {}}
        onCollapseAll={() => {}}
        onGoTo={() => {}}
      />,
    );
    expect(list.scrollTop).toBe(0);
  });
});
