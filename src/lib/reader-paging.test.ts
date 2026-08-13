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
  const idle = (): WheelPagingState => ({ accumulated: 0, lastTime: 0, flipped: false });

  it("does not turn below the threshold and keeps the remainder", () => {
    const result = consumeWheelDelta(idle(), 20, 1_000);
    expect(result.turn).toBe(0);
    expect(result.state.accumulated).toBe(20);
    expect(result.state.flipped).toBe(false);
  });

  it("turns forward at the 30px threshold and clears the remainder", () => {
    const result = consumeWheelDelta(idle(), 30, 1_000);
    expect(result.turn).toBe(1);
    expect(result.state.accumulated).toBe(0);
    expect(result.state.flipped).toBe(true);
  });

  it("turns forward once accumulated deltas reach the threshold", () => {
    const first = consumeWheelDelta(idle(), 20, 1_000);
    const second = consumeWheelDelta(first.state, 10, 1_010);
    expect(second.turn).toBe(1);
    expect(second.state.accumulated).toBe(0);
    expect(second.state.flipped).toBe(true);
  });

  it("turns backward for a negative delta at the threshold", () => {
    const result = consumeWheelDelta(idle(), -30, 1_000);
    expect(result.turn).toBe(-1);
    expect(result.state.accumulated).toBe(0);
    expect(result.state.flipped).toBe(true);
  });

  it("swallows further deltas in the same gesture after a turn", () => {
    const turned = consumeWheelDelta(idle(), 30, 1_000);
    expect(turned.turn).toBe(1);

    const during = consumeWheelDelta(turned.state, 80, 1_010);
    expect(during.turn).toBe(0);
    expect(during.state.accumulated).toBe(0);
    expect(during.state.flipped).toBe(true);
  });

  it("turns again after 200ms of idle", () => {
    const turned = consumeWheelDelta(idle(), 30, 1_000);
    const swallowed = consumeWheelDelta(turned.state, 80, 1_010);
    const after = consumeWheelDelta(swallowed.state, 30, 1_211);
    expect(after.turn).toBe(1);
    expect(after.state.flipped).toBe(true);
  });

  it("turns on a line-mode mouse notch (deltaMode 1, delta 1)", () => {
    const result = consumeWheelDelta(idle(), 1, 1_000, 1);
    expect(result.turn).toBe(1);
    expect(result.state.flipped).toBe(true);
  });
});
