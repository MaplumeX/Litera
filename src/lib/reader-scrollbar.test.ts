// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { styleBookScrollbar } from "./reader-scrollbar";

class FakeSheet {
  replaceSync() {}
}

/** A section iframe inside a closed shadow root, the way foliate mounts it. */
function bookInShadow() {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  const iframe = document.createElement("iframe");
  root.append(iframe);
  document.body.append(host);
  const doc = iframe.contentDocument!;
  (root as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = [];
  return { root: root as unknown as { adoptedStyleSheets: unknown[] }, doc };
}

describe("styleBookScrollbar", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("adds the scrollbar sheet to the Book's shadow root once, across sections", () => {
    (globalThis as unknown as { CSSStyleSheet: unknown }).CSSStyleSheet = FakeSheet;
    const { root, doc } = bookInShadow();
    const existing = {};
    root.adoptedStyleSheets = [existing];

    styleBookScrollbar(doc);
    styleBookScrollbar(doc);

    expect(root.adoptedStyleSheets).toHaveLength(2);
    expect(root.adoptedStyleSheets[0]).toBe(existing);
  });

  it("leaves a document outside any shadow root alone", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    expect(() => styleBookScrollbar(iframe.contentDocument!)).not.toThrow();
  });
});
