// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  bindPointerPaging,
  consumeWheelDelta,
  hitFromClientX,
  isFindShortcut,
  isSeekBurst,
  pageLocalX,
  pageWidthOf,
  readerKeyAction,
  scrolledBoundaryDirection,
  SEEK_BURST_MS,
  shouldIgnorePagingTarget,
  shouldIgnoreSpaceTarget,
  volumeKeyAction,
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

  it("ignores sliders, which own their arrow keys", () => {
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    expect(shouldIgnorePagingTarget(slider)).toBe(true);
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

describe("bindPointerPaging", () => {
  function click(target: HTMLElement, clientX: number) {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX, clientY: 10, bubbles: true }),
    );
    target.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX, clientY: 10, bubbles: true }),
    );
  }

  it("does not page when shouldIgnore is true for a highlight hit", () => {
    const target = document.createElement("div");
    const pageLeft = vi.fn();
    const pageRight = vi.fn();
    const onIdlePointerUp = vi.fn();
    const unbind = bindPointerPaging(
      target,
      (event) => event.clientX,
      () => 300,
      () => null,
      pageLeft,
      pageRight,
      { shouldIgnore: () => true, onIdlePointerUp },
    );
    click(target, 10);
    expect(pageLeft).not.toHaveBeenCalled();
    expect(pageRight).not.toHaveBeenCalled();
    expect(onIdlePointerUp).not.toHaveBeenCalled();
    unbind();
  });

  it("pages left and reports a blank click when shouldIgnore is false", () => {
    const target = document.createElement("div");
    const pageLeft = vi.fn();
    const pageRight = vi.fn();
    const onIdlePointerUp = vi.fn();
    const unbind = bindPointerPaging(
      target,
      (event) => event.clientX,
      () => 300,
      () => null,
      pageLeft,
      pageRight,
      { shouldIgnore: () => false, onIdlePointerUp },
    );
    click(target, 10);
    expect(onIdlePointerUp).toHaveBeenCalledOnce();
    expect(pageLeft).toHaveBeenCalledOnce();
    expect(pageRight).not.toHaveBeenCalled();
    unbind();
  });

  function bindTouch(options: Parameters<typeof bindPointerPaging>[6] = {}) {
    const target = document.createElement("div");
    const pageLeft = vi.fn();
    const pageRight = vi.fn();
    const onMiddleTap = vi.fn();
    const unbind = bindPointerPaging(
      target,
      (event) => event.clientX,
      () => 300,
      () => null,
      pageLeft,
      pageRight,
      { onMiddleTap, ...options },
    );
    return { target, pageLeft, pageRight, onMiddleTap, unbind };
  }

  it("reports a tap in the middle third without turning the page", () => {
    const { target, pageLeft, pageRight, onMiddleTap, unbind } = bindTouch();
    click(target, 150);
    expect(onMiddleTap).toHaveBeenCalledOnce();
    expect(pageLeft).not.toHaveBeenCalled();
    expect(pageRight).not.toHaveBeenCalled();
    unbind();
  });

  it("turns the page on a tap in the right third, not toggling chrome", () => {
    const { target, pageRight, onMiddleTap, unbind } = bindTouch();
    click(target, 280);
    expect(pageRight).toHaveBeenCalledOnce();
    expect(onMiddleTap).not.toHaveBeenCalled();
    unbind();
  });

  it("does not report a middle tap at the end of a swipe", () => {
    const { target, onMiddleTap, pageLeft, pageRight, unbind } = bindTouch();
    target.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, clientX: 250, clientY: 10, bubbles: true }),
    );
    target.dispatchEvent(
      new PointerEvent("pointerup", { button: 0, clientX: 150, clientY: 12, bubbles: true }),
    );
    expect(onMiddleTap).not.toHaveBeenCalled();
    expect(pageLeft).not.toHaveBeenCalled();
    expect(pageRight).not.toHaveBeenCalled();
    unbind();
  });

  it("does not report a middle tap on an interactive target (highlight, image)", () => {
    const { target, onMiddleTap, unbind } = bindTouch({ shouldIgnore: () => true });
    click(target, 150);
    expect(onMiddleTap).not.toHaveBeenCalled();
    unbind();
  });

  it("does not report a middle tap on a link", () => {
    const { target, onMiddleTap, unbind } = bindTouch();
    const link = document.createElement("a");
    link.href = "#note";
    target.appendChild(link);
    click(link, 150);
    expect(onMiddleTap).not.toHaveBeenCalled();
    unbind();
  });
});

describe("volumeKeyAction", () => {
  const reading = { enabled: true, readerActive: true };

  it("turns forward on volume down and back on volume up", () => {
    expect(volumeKeyAction("down", reading)).toBe("next");
    expect(volumeKeyAction("up", reading)).toBe("prev");
  });

  it("does nothing while the setting is off", () => {
    expect(volumeKeyAction("down", { ...reading, enabled: false })).toBeNull();
  });

  it("does nothing outside the Reader page", () => {
    expect(volumeKeyAction("down", { ...reading, readerActive: false })).toBeNull();
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

describe("readerKeyAction", () => {
  const paged = { scrolled: false, ttsActive: false };
  const scrolled = { scrolled: true, ttsActive: false };

  it("turns pages with Space, Shift+Space, PageUp and PageDown", () => {
    expect(readerKeyAction({ key: " " }, paged)).toBe("next");
    expect(readerKeyAction({ key: " ", shiftKey: true }, paged)).toBe("prev");
    expect(readerKeyAction({ key: "PageDown" }, paged)).toBe("next");
    expect(readerKeyAction({ key: "PageUp" }, paged)).toBe("prev");
  });

  it("lets Space toggle read-aloud only while it is active", () => {
    const tts = { scrolled: false, ttsActive: true };
    expect(readerKeyAction({ key: " " }, tts)).toBe("ttsToggle");
    expect(readerKeyAction({ key: " ", shiftKey: true }, tts)).toBe("prev");
  });

  it("keeps ←/→ as page direction and ↑/↓ as reading order", () => {
    expect(readerKeyAction({ key: "ArrowLeft" }, paged)).toBe("left");
    expect(readerKeyAction({ key: "ArrowRight" }, paged)).toBe("right");
    expect(readerKeyAction({ key: "ArrowUp" }, paged)).toBe("prev");
    expect(readerKeyAction({ key: "ArrowDown" }, paged)).toBe("next");
  });

  it("scrolls by lines with ↑/↓ in scrolled flow", () => {
    expect(readerKeyAction({ key: "ArrowUp" }, scrolled)).toBe("lineUp");
    expect(readerKeyAction({ key: "ArrowDown" }, scrolled)).toBe("lineDown");
    expect(readerKeyAction({ key: "ArrowRight" }, scrolled)).toBe("right");
  });

  it("jumps to the book's ends with Home / End", () => {
    expect(readerKeyAction({ key: "Home" }, paged)).toBe("start");
    expect(readerKeyAction({ key: "End" }, paged)).toBe("end");
  });

  it("walks the jump history with Alt+←/→", () => {
    expect(readerKeyAction({ key: "ArrowLeft", altKey: true }, paged)).toBe("back");
    expect(readerKeyAction({ key: "ArrowRight", altKey: true }, paged)).toBe("forward");
    expect(readerKeyAction({ key: "ArrowUp", altKey: true }, paged)).toBeNull();
  });

  it("leaves Ctrl/⌘ shortcuts and unknown keys alone", () => {
    expect(readerKeyAction({ key: "ArrowRight", ctrlKey: true }, paged)).toBeNull();
    expect(readerKeyAction({ key: " ", metaKey: true }, paged)).toBeNull();
    expect(readerKeyAction({ key: "ArrowRight", shiftKey: true }, paged)).toBeNull();
    expect(readerKeyAction({ key: "a" }, paged)).toBeNull();
  });

  it("ignores keys typed into fields, sliders and buttons", () => {
    const input = document.createElement("input");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    const button = document.createElement("button");
    expect(readerKeyAction({ key: "PageDown", target: input }, paged)).toBeNull();
    expect(readerKeyAction({ key: "Home", target: slider }, paged)).toBeNull();
    expect(readerKeyAction({ key: " ", target: button }, paged)).toBeNull();
    // Arrows on a focused button still page; only Space would press it.
    expect(readerKeyAction({ key: "ArrowRight", target: button }, paged)).toBe("right");
  });
});

describe("isFindShortcut", () => {
  it("matches Ctrl+F and ⌘+F only", () => {
    expect(isFindShortcut({ key: "f", ctrlKey: true })).toBe(true);
    expect(isFindShortcut({ key: "F", metaKey: true })).toBe(true);
    expect(isFindShortcut({ key: "f" })).toBe(false);
    expect(isFindShortcut({ key: "f", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isFindShortcut({ key: "g", ctrlKey: true })).toBe(false);
  });
});

describe("isSeekBurst", () => {
  it("joins seeks closer together than the burst window", () => {
    expect(isSeekBurst(0, 1_000)).toBe(false);
    expect(isSeekBurst(1_000, 1_000 + SEEK_BURST_MS - 1)).toBe(true);
    expect(isSeekBurst(1_000, 1_000 + SEEK_BURST_MS)).toBe(false);
  });
});

describe("scrolledBoundaryDirection", () => {
  it("scrolls natively inside the section", () => {
    expect(scrolledBoundaryDirection(40, { start: 100, size: 500, viewSize: 2000 })).toBe(0);
    expect(scrolledBoundaryDirection(-40, { start: 100, size: 500, viewSize: 2000 })).toBe(0);
  });

  it("crosses into the next section past the end", () => {
    expect(scrolledBoundaryDirection(40, { start: 1500, size: 500, viewSize: 2000 })).toBe(1);
    expect(scrolledBoundaryDirection(-40, { start: 1500, size: 500, viewSize: 2000 })).toBe(0);
  });

  it("crosses into the previous section past the start", () => {
    expect(scrolledBoundaryDirection(-40, { start: 0, size: 500, viewSize: 2000 })).toBe(-1);
    expect(scrolledBoundaryDirection(40, { start: 0, size: 500, viewSize: 2000 })).toBe(0);
  });
});
