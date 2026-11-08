// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldHeight } from "./HoldHeight";

let report: (height: number) => void;
const disconnect = vi.fn();

beforeEach(() => {
  disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: Array<{ contentRect: { height: number } }>) => void) {
        report = (height) => callback([{ contentRect: { height } }]);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function block(view: ReturnType<typeof render>) {
  return view.container.firstElementChild as HTMLElement;
}

describe("HoldHeight", () => {
  it("keeps the tallest height seen while active", () => {
    const view = render(<HoldHeight active>内容</HoldHeight>);
    report(100);
    expect(block(view).style.minHeight).toBe("100px");
    report(60);
    expect(block(view).style.minHeight).toBe("100px");
    report(140);
    expect(block(view).style.minHeight).toBe("140px");
  });

  it("lets go once inactive", () => {
    const view = render(<HoldHeight active>内容</HoldHeight>);
    report(100);
    view.rerender(<HoldHeight active={false}>内容</HoldHeight>);
    expect(block(view).style.minHeight).toBe("");
    expect(disconnect).toHaveBeenCalled();
  });

  it("holds nothing when never active", () => {
    const view = render(<HoldHeight active={false}>内容</HoldHeight>);
    expect(block(view).style.minHeight).toBe("");
  });
});
