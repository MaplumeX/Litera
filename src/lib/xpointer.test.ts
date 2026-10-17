// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseXPointer, rangeFromXPointer, sectionXPointer, xpointerFromRange } from "./xpointer";

function chapter(body: string): Document {
  return new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    "application/xhtml+xml",
  );
}

function rangeAt(node: Node, offset: number): Range {
  const range = node.ownerDocument!.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  return range;
}

describe("parseXPointer", () => {
  it("reads the spine index, element steps, and text step", () => {
    expect(parseXPointer("/body/DocFragment[12]/body/div/p[5]/text().38")).toEqual({
      sectionIndex: 11,
      steps: [
        { name: "div", index: 1 },
        { name: "p", index: 5 },
      ],
      text: { index: 1, offset: 38 },
    });
  });

  it("reads a chapter-start XPointer", () => {
    expect(parseXPointer("/body/DocFragment[3]/body")).toEqual({ sectionIndex: 2, steps: [], text: null });
    expect(parseXPointer("/body/DocFragment[3]")).toEqual({ sectionIndex: 2, steps: [], text: null });
  });

  it("rejects anything that is not a CREngine XPointer", () => {
    expect(parseXPointer("epubcfi(/6/4!/4/2)")).toBeNull();
    expect(parseXPointer("42")).toBeNull();
    expect(parseXPointer("/body/DocFragment[2]/body/text().3/p")).toBeNull();
  });
});

describe("xpointerFromRange", () => {
  it("numbers repeated siblings and omits the index of a unique one", () => {
    const doc = chapter("<div><p>one</p><p>two</p><p>three</p></div>");
    const third = doc.getElementsByTagName("p")[2];
    expect(xpointerFromRange(rangeAt(third, 0), 4)).toBe("/body/DocFragment[5]/body/div/p[3]/text().0");
    expect(xpointerFromRange(rangeAt(doc.getElementsByTagName("div")[0], 1), 4)).toBe(
      "/body/DocFragment[5]/body/div/p[2]",
    );
  });

  it("adds a code-point text offset inside a single text node", () => {
    const doc = chapter("<p>first</p><p>héllo 😀 world</p>");
    const text = doc.getElementsByTagName("p")[1].firstChild!;
    // "héllo 😀 " is 8 code points but 9 UTF-16 units.
    expect(xpointerFromRange(rangeAt(text, 9), 0)).toBe("/body/DocFragment[1]/body/p[2]/text().8");
  });

  it("stays element-level when CREngine could number or collapse text differently", () => {
    const doc = chapter("<p>a <b>bold</b> tail</p><p>\n  indented text</p>");
    const [mixed, indented] = Array.from(doc.getElementsByTagName("p"));
    expect(xpointerFromRange(rangeAt(mixed.lastChild!, 2), 0)).toBe("/body/DocFragment[1]/body/p[1]");
    expect(xpointerFromRange(rangeAt(indented.firstChild!, 8), 0)).toBe("/body/DocFragment[1]/body/p[2]");
  });

  it("follows an element-boundary range into the child it points at", () => {
    const doc = chapter("<section><h2>Title</h2><p>body</p></section>");
    const section = doc.getElementsByTagName("section")[0];
    expect(xpointerFromRange(rangeAt(section, 1), 2)).toBe("/body/DocFragment[3]/body/section/p");
  });

  it("falls back to the chapter start outside the body", () => {
    const doc = chapter("<p>x</p>");
    const title = doc.getElementsByTagName("title")[0];
    expect(xpointerFromRange(rangeAt(title, 0), 6)).toBe(sectionXPointer(6));
  });
});

describe("rangeFromXPointer", () => {
  it("resolves element steps and a text offset", () => {
    const doc = chapter("<div><p>one</p><p>two words</p></div>");
    const range = rangeFromXPointer(doc, "/body/DocFragment[1]/body/div/p[2]/text().4")!;
    expect(range.startContainer.textContent).toBe("two words");
    expect(range.startOffset).toBe(4);
  });

  it("maps a collapsed-text offset back onto raw whitespace", () => {
    const doc = chapter("<p>two   spaced  words</p>");
    const range = rangeFromXPointer(doc, "/body/DocFragment[1]/body/p/text().11")!;
    // Collapsed "two spaced words": offset 11 is the "w" of "words".
    expect((range.startContainer as Text).data.slice(range.startOffset)).toBe("words");
  });

  it("stops at the deepest element that resolves", () => {
    const doc = chapter("<div><p>only</p></div>");
    const range = rangeFromXPointer(doc, "/body/DocFragment[1]/body/div/p[4]/text().2")!;
    expect(range.startContainer).toBe(doc.getElementsByTagName("div")[0]);
  });

  it("round-trips to the same block", () => {
    const doc = chapter("<div><p>a</p><blockquote><p>quoted text here</p></blockquote><p>b</p></div>");
    const text = doc.getElementsByTagName("blockquote")[0].firstElementChild!.firstChild!;
    const xpointer = xpointerFromRange(rangeAt(text, 7), 9);
    const range = rangeFromXPointer(doc, xpointer)!;
    expect(range.startContainer).toBe(text);
    expect(range.startOffset).toBe(7);
  });

  it("returns null for an unreadable XPointer", () => {
    expect(rangeFromXPointer(chapter("<p>x</p>"), "nonsense")).toBeNull();
  });
});
