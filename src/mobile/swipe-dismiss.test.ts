// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { canStartDrag, shouldDismiss } from "@/mobile/swipe-dismiss";

describe("shouldDismiss", () => {
  it("closes past 30% of the panel, or on a flick toward the edge", () => {
    expect(shouldDismiss(120, 0, 400)).toBe(true);
    expect(shouldDismiss(100, 0, 400)).toBe(false);
    expect(shouldDismiss(40, 0.8, 400)).toBe(true);
  });

  it("never closes a panel that wasn't moved toward the edge", () => {
    expect(shouldDismiss(0, 2, 400)).toBe(false);
  });
});

describe("canStartDrag", () => {
  function sheet(html: string) {
    document.body.innerHTML = `<div id="panel">${html}</div>`;
    return document.getElementById("panel") as HTMLElement;
  }

  it("drags from plain content", () => {
    const panel = sheet(`<p id="t">text</p>`);
    expect(canStartDrag(document.getElementById("t")!, panel, "down")).toBe(true);
  });

  it("leaves text fields and self-handling controls alone", () => {
    const panel = sheet(`<input id="i" /><div style="touch-action: none"><span id="s"></span></div>`);
    expect(canStartDrag(document.getElementById("i")!, panel, "down")).toBe(false);
    expect(canStartDrag(document.getElementById("s")!, panel, "left")).toBe(false);
  });

  it("lets a scrolled sheet scroll back up first", () => {
    const panel = sheet(`<div id="scroller"><p id="t">text</p></div>`);
    const scroller = document.getElementById("scroller")!;
    Object.defineProperty(scroller, "scrollTop", { value: 50 });
    expect(canStartDrag(document.getElementById("t")!, panel, "down")).toBe(false);
    expect(canStartDrag(document.getElementById("t")!, panel, "left")).toBe(true);
  });
});
