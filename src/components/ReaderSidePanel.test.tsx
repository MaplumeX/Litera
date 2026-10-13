// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaderSidePanel } from "@/components/ReaderSidePanel";

afterEach(() => {
  cleanup();
});

describe("ReaderSidePanel", () => {
  it("marks the active tab and switches on click", () => {
    const onTabChange = vi.fn();
    const { getByRole } = render(
      <ReaderSidePanel tab="toc" onTabChange={onTabChange}>
        <p>body</p>
      </ReaderSidePanel>,
    );
    expect(getByRole("tab", { name: "目录" }).getAttribute("aria-selected")).toBe("true");
    expect(getByRole("tab", { name: "标注" }).getAttribute("aria-selected")).toBe("false");
    fireEvent.click(getByRole("tab", { name: "标注" }));
    expect(onTabChange).toHaveBeenCalledWith("annotations");
  });

  it("uses a header row as dense as the window header, without a rule", () => {
    const { getByRole } = render(
      <ReaderSidePanel tab="toc" onTabChange={() => {}} actions={<button>act</button>}>
        <p>body</p>
      </ReaderSidePanel>,
    );
    const header = getByRole("tablist").parentElement!;
    expect(header.className).toContain("h-12");
    expect(header.className).not.toContain("border-b");
    expect(header.contains(getByRole("button", { name: "act" }))).toBe(true);
    expect(getByRole("tabpanel").textContent).toBe("body");
  });
});
