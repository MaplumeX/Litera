// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchSwitcher } from "./BranchSwitcher";
import { setLocale } from "@/lib/i18n";

beforeEach(() => {
  setLocale("zh-CN");
});

afterEach(() => {
  cleanup();
});

describe("BranchSwitcher", () => {
  it("renders the current position with tabular numerals", () => {
    const view = render(<BranchSwitcher current={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(view.getByText("2/3")).toBeTruthy();
    expect(view.getByText("2/3").className).toContain("tabular-nums");
  });

  it("disables prev at the first branch and next at the last branch", () => {
    const view = render(<BranchSwitcher current={1} total={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect((view.getByRole("button", { name: "切换到上一个分支" }) as HTMLButtonElement).disabled).toBe(true);
    expect((view.getByRole("button", { name: "切换到下一个分支" }) as HTMLButtonElement).disabled).toBe(false);

    cleanup();
    const last = render(<BranchSwitcher current={3} total={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect((last.getByRole("button", { name: "切换到上一个分支" }) as HTMLButtonElement).disabled).toBe(false);
    expect((last.getByRole("button", { name: "切换到下一个分支" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires onPrev and onNext from the arrow buttons", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const view = render(<BranchSwitcher current={2} total={3} onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(view.getByRole("button", { name: "切换到上一个分支" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("button", { name: "切换到下一个分支" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables both arrows when the switcher is disabled", () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const view = render(
      <BranchSwitcher current={2} total={3} disabled onPrev={onPrev} onNext={onNext} />,
    );
    const prev = view.getByRole("button", { name: "切换到上一个分支" }) as HTMLButtonElement;
    const next = view.getByRole("button", { name: "切换到下一个分支" }) as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    fireEvent.click(prev);
    fireEvent.click(next);
    expect(onPrev).not.toHaveBeenCalled();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("uses English aria-labels in the English locale", () => {
    setLocale("en");
    const view = render(<BranchSwitcher current={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />);
    expect(view.getByRole("button", { name: "Previous branch" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Next branch" })).toBeTruthy();
  });
});
