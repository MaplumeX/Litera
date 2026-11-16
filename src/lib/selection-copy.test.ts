// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { latexSelectionText } from "./selection-copy";

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

/** A range over the whole body, or from `from` to `to` inside one text node. */
function rangeOver(doc: Document, from?: string, to?: string): Range {
  const range = doc.createRange();
  if (from === undefined) {
    range.selectNodeContents(doc.body);
    return range;
  }
  const start = textNode(doc, from);
  const end = to === undefined ? start : textNode(doc, to);
  range.setStart(start, 0);
  range.setEnd(end, end.textContent?.length ?? 0);
  return range;
}

const FRACTION = "<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>";

describe("latexSelectionText", () => {
  it("writes an inline formula as its LaTeX", () => {
    const doc = page(`<p>取 ${FRACTION} 即可。</p>`);
    expect(latexSelectionText(rangeOver(doc))).toBe("取 $\\frac{1}{2}$ 即可。");
  });

  it("keeps the surrounding text as range.toString() gives it", () => {
    const doc = page(`<p>Alpha ${FRACTION} beta</p>`);
    const range = rangeOver(doc, "Alpha", "beta");
    expect(range.toString()).toBe("Alpha 12 beta");
    expect(latexSelectionText(range)).toBe("Alpha $\\frac{1}{2}$ beta");
  });

  it("copies the whole formula when only part of it is selected", () => {
    const doc = page(`<p>前 ${FRACTION} 后</p>`);
    const denominator = textNode(doc, "2");
    const range = doc.createRange();
    range.setStart(denominator, 0);
    range.setEnd(denominator, 1);
    expect(latexSelectionText(range)).toBe("$\\frac{1}{2}$");
  });

  it("marks display math with double dollars", () => {
    const doc = page('<math display="block"><msup><mi>x</mi><mn>2</mn></msup></math>');
    expect(latexSelectionText(rangeOver(doc))).toBe("$$x^2$$");
  });

  it("prefers the TeX the book ships as an annotation", () => {
    const doc = page(
      '<p><math><semantics><mfrac><mn>1</mn><mn>2</mn></mfrac>' +
        '<annotation encoding="application/x-tex">\\frac12</annotation></semantics></math></p>',
    );
    expect(latexSelectionText(rangeOver(doc))).toBe("$\\frac12$");
  });

  it("is null when the selection has no formula", () => {
    const doc = page("<p>只是文字。</p>");
    expect(latexSelectionText(rangeOver(doc))).toBeNull();
  });

  it("is null for an image formula, which has no math to convert", () => {
    const doc = page('<p>前 <img src="eq1.png" alt="1/2"> 后</p>');
    expect(latexSelectionText(rangeOver(doc))).toBeNull();
  });

  it("keeps a formula with no usable content as its text", () => {
    const doc = page("<p>A<math><mphantom><mn>9</mn></mphantom></math>B</p>");
    expect(latexSelectionText(rangeOver(doc))).toBe("A9B");
  });
});
