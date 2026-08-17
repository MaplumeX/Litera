// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  consumeWheelDelta,
  hitFromClientX,
  pageLocalX,
  pageWidthOf,
  shouldIgnorePagingTarget,
  shouldIgnoreSpaceTarget,
  type WheelPagingState,
} from "./reader-paging";

describe("pageLocalX", () => {
  it("maps the first page edges onto themselves", () => {
    expect(pageLocalX(0, 800)).toBe(0);
    expect(pageLocalX(799, 800)).toBe(799);
  });

  it("wraps the next page's left edge to 0", () => {
    expect(pageLocalX(800, 800)).toBe(0);
  });

  it("maps later-page coordinates onto the visible page", () => {
    expect(pageLocalX(1600 + 50, 800)).toBe(50);
    expect(pageLocalX(1600 + 700, 800)).toBe(700);
  });

  it("folds a negative remainder into the positive interval", () => {
    expect(pageLocalX(-50, 800)).toBe(750);
  });

  it("returns 0 when pageWidth is not positive", () => {
    expect(pageLocalX(10, 0)).toBe(0);
  });

  it("keeps left/right hit zones after mapping page 3", () => {
    expect(hitFromClientX(pageLocalX(1600 + 50, 800), 800)).toBe("left");
    expect(hitFromClientX(pageLocalX(1600 + 700, 800), 800)).toBe("right");
  });
});

/** Chapter iframe whose viewport is the whole strip but `<html>` is one spread. */
function chapterDoc(layoutWidth: number, viewportWidth: number): Document {
  return {
    documentElement: {
      clientWidth: viewportWidth,
      getBoundingClientRect: () => ({ width: layoutWidth }) as DOMRect,
    },
    defaultView: { innerWidth: viewportWidth },
  } as unknown as Document;
}

describe("pageWidthOf", () => {
  it("uses html layout width, not root clientWidth or innerWidth", () => {
    const doc = chapterDoc(800, 4000);
    expect(doc.documentElement.clientWidth).toBe(4000);
    expect(doc.defaultView?.innerWidth).toBe(4000);
    expect(pageWidthOf(doc)).toBe(800);
  });

  it("keeps last-page and next-chapter first-page clicks on the same zone", () => {
    const longChapter = chapterDoc(800, 4000);
    // Next chapter must also be a strip; a 1-page next chapter makes clientWidth
    // equal layout width and hides the left/right flip.
    const nextChapter = chapterDoc(800, 3200);
    const width = pageWidthOf(longChapter);
    const nextWidth = pageWidthOf(nextChapter);
    const lastPageLeft = pageLocalX(3200 + 50, width);
    const lastPageRight = pageLocalX(3200 + 700, width);
    const nextFirstPageRight = pageLocalX(700, nextWidth);
    expect(hitFromClientX(lastPageLeft, width)).toBe("left");
    expect(hitFromClientX(lastPageRight, width)).toBe("right");
    expect(hitFromClientX(nextFirstPageRight, nextWidth)).toBe("right");
  });
});

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

describe("shouldIgnoreSpaceTarget", () => {
  it("still ignores paging targets", () => {
    expect(shouldIgnoreSpaceTarget(document.createElement("textarea"))).toBe(true);
    expect(shouldIgnoreSpaceTarget(document.createElement("input"))).toBe(true);
  });

  it("ignores buttons and sliders so Space does not double-toggle", () => {
    expect(shouldIgnoreSpaceTarget(document.createElement("button"))).toBe(true);
    const roleButton = document.createElement("div");
    roleButton.setAttribute("role", "button");
    expect(shouldIgnoreSpaceTarget(roleButton)).toBe(true);
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    expect(shouldIgnoreSpaceTarget(slider)).toBe(true);
    const range = document.createElement("input");
    range.type = "range";
    expect(shouldIgnoreSpaceTarget(range)).toBe(true);
  });

  it("allows ordinary reading targets", () => {
    expect(shouldIgnoreSpaceTarget(document.createElement("p"))).toBe(false);
    expect(shouldIgnoreSpaceTarget(null)).toBe(false);
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
