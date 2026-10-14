// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clampZoom, opensImageViewer, readerImageAt, zoomFromWheel } from "./reader-images";

function chapter(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("readerImageAt", () => {
  it("finds an <img> and its alt text", () => {
    const doc = chapter('<p><img src="blob:pic" alt=" A map "></p>');
    const hit = readerImageAt(doc.querySelector("img"));
    expect(hit?.image).toEqual({ src: "blob:pic", alt: "A map" });
  });

  it("finds an SVG <image> by href or xlink:href", () => {
    const doc = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="blob:svg-pic"/></svg>',
      "image/svg+xml",
    );
    expect(readerImageAt(doc.querySelector("image"))?.image.src).toBe("blob:svg-pic");
  });

  it("leaves pictures inside links to the link", () => {
    const doc = chapter('<a href="#n1"><img src="blob:pic"></a>');
    expect(readerImageAt(doc.querySelector("img"))).toBeNull();
  });

  it("ignores text and pictures without a source", () => {
    const doc = chapter("<p>text</p><img>");
    expect(readerImageAt(doc.querySelector("p")?.firstChild)).toBeNull();
    expect(readerImageAt(doc.querySelector("img"))).toBeNull();
    expect(readerImageAt(null)).toBeNull();
  });
});

describe("opensImageViewer", () => {
  it("opens inline pictures from any zone", () => {
    expect(
      opensImageViewer({ scrolled: false, zone: "left", imageHeight: 200, pageHeight: 800 }),
    ).toBe(true);
  });

  it("keeps the edges of a full-page picture for turning pages", () => {
    const fullPage = { scrolled: false, imageHeight: 760, pageHeight: 800 } as const;
    expect(opensImageViewer({ ...fullPage, zone: "right" })).toBe(false);
    expect(opensImageViewer({ ...fullPage, zone: "middle" })).toBe(true);
  });

  it("opens from anywhere in scrolled flow", () => {
    expect(
      opensImageViewer({ scrolled: true, zone: "right", imageHeight: 760, pageHeight: 800 }),
    ).toBe(true);
  });
});

describe("zoom", () => {
  it("clamps to the fit-to-window floor and the 6× ceiling", () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(10)).toBe(6);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("zooms in on wheel up and out on wheel down", () => {
    expect(zoomFromWheel(2, -100)).toBeGreaterThan(2);
    expect(zoomFromWheel(2, 100)).toBeLessThan(2);
  });
});
