// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  consumeWheelDelta,
  hitFromClientX,
  shouldIgnorePagingTarget,
  type WheelPagingState,
} from "./reader-paging";

describe("hitFromClientX", () => {
  it("maps the left third, including the left edge", () => {
    expect(hitFromClientX(0, 300)).toBe("left");
    expect(hitFromClientX(99, 300)).toBe("left");
  });

  it("maps the middle third, including both inner boundaries", () => {
    expect(hitFromClientX(100, 300)).toBe("middle");
    expect(hitFromClientX(200, 300)).toBe("middle");
  });

  it("maps the right third past 2/3", () => {
    expect(hitFromClientX(201, 300)).toBe("right");
    expect(hitFromClientX(300, 300)).toBe("right");
  });

  it("treats a non-positive width as middle", () => {
    expect(hitFromClientX(0, 0)).toBe("middle");
    expect(hitFromClientX(10, -1)).toBe("middle");
  });
});

describe("shouldIgnorePagingTarget", () => {
  it("ignores input, textarea, and select", () => {
    expect(shouldIgnorePagingTarget(document.createElement("input"))).toBe(true);
    expect(shouldIgnorePagingTarget(document.createElement("textarea"))).toBe(true);
    expect(shouldIgnorePagingTarget(document.createElement("select"))).toBe(true);
  });

  it("ignores contentEditable elements", () => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    expect(shouldIgnorePagingTarget(el)).toBe(true);
  });

  it("ignores descendants of [role=dialog]", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inner = document.createElement("button");
    dialog.appendChild(inner);
    expect(shouldIgnorePagingTarget(inner)).toBe(true);
  });

  it("allows ordinary reading targets and null", () => {
    expect(shouldIgnorePagingTarget(document.createElement("p"))).toBe(false);
    expect(shouldIgnorePagingTarget(null)).toBe(false);
  });
});

describe("consumeWheelDelta", () => {
  const idle = (): WheelPagingState => ({ accumulated: 0, cooldownUntil: 0 });

  it("does not turn below the threshold and keeps the remainder", () => {
    const result = consumeWheelDelta(idle(), 40, 1_000);
    expect(result.turn).toBe(0);
    expect(result.state.accumulated).toBe(40);
    expect(result.state.cooldownUntil).toBe(0);
  });

  it("turns forward once the accumulated delta reaches the threshold and clears", () => {
    const first = consumeWheelDelta(idle(), 50, 1_000);
    const second = consumeWheelDelta(first.state, 30, 1_000);
    expect(second.turn).toBe(1);
    expect(second.state.accumulated).toBe(0);
    expect(second.state.cooldownUntil).toBeGreaterThan(1_000);
  });

  it("turns backward for a negative delta at the threshold", () => {
    const result = consumeWheelDelta(idle(), -80, 1_000);
    expect(result.turn).toBe(-1);
    expect(result.state.accumulated).toBe(0);
  });

  it("ignores further deltas during cooldown, then turns again after it expires", () => {
    const turned = consumeWheelDelta(idle(), 80, 1_000);
    expect(turned.turn).toBe(1);

    const during = consumeWheelDelta(turned.state, 80, 1_010);
    expect(during.turn).toBe(0);
    expect(during.state.accumulated).toBe(0);
    expect(during.state.cooldownUntil).toBeGreaterThan(turned.state.cooldownUntil);

    const after = consumeWheelDelta(during.state, 80, 10_000);
    expect(after.turn).toBe(1);
  });
});
