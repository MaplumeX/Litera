// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hideUntilFontsReady } from "./reader-font-gate";

function docWithFonts(ready: Promise<unknown>): Document {
  const doc = document.implementation.createHTMLDocument("chapter");
  Object.defineProperty(doc, "fonts", { value: { ready } });
  return doc;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("hideUntilFontsReady", () => {
  it("keeps the chapter hidden until its fonts are ready", async () => {
    let fontsLoaded!: () => void;
    const doc = docWithFonts(new Promise<void>((r) => (fontsLoaded = r)));

    const shown = hideUntilFontsReady(doc);
    expect(doc.documentElement.style.getPropertyValue("visibility")).toBe("hidden");

    await vi.advanceTimersByTimeAsync(100);
    expect(doc.documentElement.style.getPropertyValue("visibility")).toBe("hidden");

    fontsLoaded();
    await shown;
    expect(doc.documentElement.style.getPropertyValue("visibility")).toBe("");
  });

  it("shows the chapter after the limit even if a font never loads", async () => {
    const doc = docWithFonts(new Promise(() => {}));

    const shown = hideUntilFontsReady(doc, 500);
    await vi.advanceTimersByTimeAsync(600);
    await shown;

    expect(doc.documentElement.style.getPropertyValue("visibility")).toBe("");
  });
});
