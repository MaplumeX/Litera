// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocItem } from "@/components/ReaderView";
import { TocSidebar } from "@/components/TocSidebar";

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
});
