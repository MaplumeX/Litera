// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/ui/segmented-control";

const OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
] as const;

afterEach(cleanup);

describe("SegmentedControl", () => {
  it("names the group and checks the current value", () => {
    const { getByRole } = render(
      <SegmentedControl value="on" options={OPTIONS} onChange={vi.fn()} ariaLabel="Sync" />,
    );
    expect(getByRole("radiogroup", { name: "Sync" })).toBeTruthy();
    expect(getByRole("radio", { name: "On" }).getAttribute("aria-checked")).toBe("true");
    expect(getByRole("radio", { name: "Off" }).getAttribute("aria-checked")).toBe("false");
  });

  it("is one tab stop: arrow keys move focus and wrap, Space picks", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <SegmentedControl value="off" options={OPTIONS} onChange={onChange} ariaLabel="Sync" />,
    );
    const off = getByRole("radio", { name: "Off" });
    const on = getByRole("radio", { name: "On" });
    expect(off.tabIndex).toBe(0);
    expect(on.tabIndex).toBe(-1);
    off.focus();
    fireEvent.keyDown(off, { key: "ArrowRight" });
    expect(document.activeElement).toBe(on);
    fireEvent.keyDown(on, { key: "ArrowRight" });
    expect(document.activeElement).toBe(off);
    fireEvent.keyDown(off, { key: "ArrowLeft" });
    fireEvent.keyDown(on, { key: " " });
    expect(onChange).toHaveBeenCalledWith("on");
  });
});
