// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyGuideMarks, guideMarkKey } from "./guide-marks";

function page(html: string): Document {
  const doc = document.implementation.createHTMLDocument("page");
  doc.body.innerHTML = html;
  return doc;
}

const marks = (read: string[], skimmed: string[] = [], cursor?: string) => ({
  read: read.map(guideMarkKey),
  skimmed: skimmed.map(guideMarkKey),
  ...(cursor ? { cursor: guideMarkKey(cursor) } : {}),
});

describe("guideMarkKey", () => {
  it("is the opening text without whitespace", () => {
    expect(guideMarkKey("  Local  government\n matters ")).toBe("Localgovernmentmatters");
    expect(guideMarkKey("x".repeat(100))).toHaveLength(32);
  });
});

describe("applyGuideMarks", () => {
  it("marks read, skimmed and cursor paragraphs, leaving wrappers and the rest alone", () => {
    const doc = page('<div class="wrap"><h2>Later</h2><p>Read <em>this</em> one.</p><p>Skimmed one.</p><p>Untouched.</p><ul><li>first item</li><li>second item</li></ul></div>');
    applyGuideMarks(doc, marks(["Later", "Read this one.", "first item second item"], ["Skimmed one."], "Skimmed one."), "带读到这里");
    const state = (selector: string) => doc.querySelector(selector)!.getAttribute("data-litera-guide");
    expect(doc.querySelector(".wrap")!.hasAttribute("data-litera-guide")).toBe(false);
    expect(state("h2")).toBe("read");
    expect(state("p:nth-of-type(1)")).toBe("read");
    expect(state("p:nth-of-type(2)")).toBe("skim");
    expect(state("p:nth-of-type(3)")).toBeNull();
    expect(state("ul")).toBe("read");
    expect(state("li")).toBeNull();
    expect(doc.querySelectorAll("[data-litera-guide-cursor]")).toHaveLength(1);
    expect(doc.querySelector("p:nth-of-type(2)")!.hasAttribute("data-litera-guide-cursor")).toBe(true);
    expect(doc.getElementById("litera-guide-marks")!.textContent).toContain("带读到这里");
  });

  it("keeps each marked paragraph's own text color as the ink to fade from", () => {
    // The window's own document: computed styles need a view.
    const doc = document;
    doc.body.innerHTML = '<p style="color: rgb(10, 20, 30)">Colored one.</p><p>Plain one.</p><p>Unread one.</p>';
    applyGuideMarks(doc, marks(["Colored one.", "Plain one."], [], "Plain one."), "");
    const [colored, plain, unread] = [...doc.body.children] as HTMLElement[];
    expect(colored.style.getPropertyValue("--litera-guide-ink")).toBe("rgb(10, 20, 30)");
    expect(plain.style.getPropertyValue("--litera-guide-ink")).not.toBe("");
    expect(unread.hasAttribute("style")).toBe(false);
    applyGuideMarks(doc, null, "");
    expect(colored.style.getPropertyValue("--litera-guide-ink")).toBe("");
    expect(colored.getAttribute("style")).toBe("color: rgb(10, 20, 30);");
    expect(plain.hasAttribute("style")).toBe(false);
  });

  it("ignores footnote numbers in the page text", () => {
    const doc = page('<p>See the map<sup><a href="#n1">1</a></sup> here.</p>');
    applyGuideMarks(doc, marks(["See the map here."]), "");
    expect(doc.querySelector("p")!.getAttribute("data-litera-guide")).toBe("read");
  });

  it("clears its marks when there are none any more", () => {
    const doc = page("<p>Read one.</p>");
    applyGuideMarks(doc, marks(["Read one."], [], "Read one."), "");
    applyGuideMarks(doc, null, "");
    expect(doc.querySelector("[data-litera-guide]")).toBeNull();
    expect(doc.querySelector("[data-litera-guide-cursor]")).toBeNull();
  });
});
