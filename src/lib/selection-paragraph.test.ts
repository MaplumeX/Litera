// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { selectionParagraph } from "./selection-paragraph";

function page(html: string): Document {
  const doc = document.implementation.createHTMLDocument("page");
  doc.body.innerHTML = html;
  return doc;
}

function textNode(doc: Document, text: string): Text {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent?.includes(text)) return node as Text;
  throw new Error(`no text node with ${text}`);
}

describe("selectionParagraph", () => {
  it("is the whole paragraph a few selected characters sit in", () => {
    const doc = page("<p>Alpha beta.</p><p>Local <em>government</em>  matters\n here.</p>");
    const range = doc.createRange();
    const node = textNode(doc, "government");
    range.setStart(node, 0);
    range.setEnd(node, 3);
    expect(selectionParagraph(range)).toBe("Local government matters here.");
  });

  it("is the paragraph the selection ends in when it spans several", () => {
    const doc = page("<p>Alpha beta.</p><ul><li>One item</li><li>Two item</li></ul>");
    const range = doc.createRange();
    range.setStart(textNode(doc, "Alpha"), 2);
    range.setEnd(textNode(doc, "Two"), 3);
    expect(selectionParagraph(range)).toBe("Two item");
  });

  it("is the paragraph before when the selection stops at the very start of the next one", () => {
    const doc = page("<p>Alpha beta.</p><p>Gamma delta.</p>");
    const range = doc.createRange();
    range.setStart(textNode(doc, "Alpha"), 0);
    range.setEnd(doc.body.children[1], 0);
    expect(selectionParagraph(range)).toBe("Alpha beta.");
  });

  it("falls back to the nearest div, and is empty for a very long one", () => {
    const doc = page(`<div>Loose <span>text</span> here</div><div>${"x".repeat(5_000)}</div>`);
    const range = doc.createRange();
    range.selectNodeContents(textNode(doc, "text"));
    expect(selectionParagraph(range)).toBe("Loose text here");
    const long = doc.createRange();
    long.selectNodeContents(textNode(doc, "xxx"));
    expect(selectionParagraph(long)).toBe("");
  });
});
