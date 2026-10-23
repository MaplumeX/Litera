import { describe, expect, it } from "vitest";
import type { BookTocEntry } from "@/agent/book/book-content";
import { guideStepContext, guideTocProgress, nextGuideStep, resolveGuideStep, skipChapterStep } from "./guide";

const chapter = (index: number, parts: number, chars = 1000, label = `Chapter ${index + 1}`): BookTocEntry => ({
  index, label, ancestors: [], depth: 0, hrefs: [`c${index}.xhtml`], chars, parts,
});

// Chapter 1 is a volume heading with no text of its own.
const toc = [chapter(0, 2), chapter(1, 1, 0, "Part One"), chapter(2, 3), chapter(3, 1)];

describe("nextGuideStep", () => {
  it("starts at the first chapter with text before any step", () => {
    expect(nextGuideStep(toc, null)).toEqual({ chapterIndex: 0, part: 0, totalParts: 2, chapterTitle: "Chapter 1" });
  });

  it("starts at the given chapter, skipping chapters without text", () => {
    expect(nextGuideStep(toc, null, 1)).toMatchObject({ chapterIndex: 2, part: 0, totalParts: 3 });
    expect(nextGuideStep(toc, null, 3)).toMatchObject({ chapterIndex: 3, part: 0 });
  });

  it("moves to the next part of the same chapter", () => {
    expect(nextGuideStep(toc, { chapterIndex: 2, part: 0, totalParts: 3 })).toMatchObject({ chapterIndex: 2, part: 1 });
  });

  it("crosses into the next chapter with text after the last part", () => {
    expect(nextGuideStep(toc, { chapterIndex: 0, part: 1, totalParts: 2 })).toMatchObject({ chapterIndex: 2, part: 0 });
  });

  it("ignores the start chapter once the guide has started", () => {
    expect(nextGuideStep(toc, { chapterIndex: 0, part: 0, totalParts: 2 }, 3)).toMatchObject({ chapterIndex: 0, part: 1 });
  });

  it("returns null at the end of the Book", () => {
    expect(nextGuideStep(toc, { chapterIndex: 3, part: 0, totalParts: 1 })).toBeNull();
    expect(nextGuideStep([], null)).toBeNull();
  });

  it("restarts from the start chapter when the cursor no longer fits the Book", () => {
    expect(nextGuideStep(toc, { chapterIndex: 9, part: 0, totalParts: 1 }, 2)).toMatchObject({ chapterIndex: 2, part: 0 });
  });
});

describe("skims and skips", () => {
  it("moves past the whole chapter after a skim, whatever part it started at", () => {
    expect(nextGuideStep(toc, { chapterIndex: 2, part: 1, totalParts: 3, skim: true })).toMatchObject({ chapterIndex: 3, part: 0 });
  });

  it("skips to the next chapter with text, or to the end", () => {
    expect(skipChapterStep(toc, { chapterIndex: 0, part: 0, totalParts: 2 })).toMatchObject({ chapterIndex: 2, part: 0 });
    expect(skipChapterStep(toc, { chapterIndex: 3, part: 0, totalParts: 1 })).toBeNull();
  });

  it("keeps the skim through resolution and names every remaining part", () => {
    const step = resolveGuideStep(toc, { chapterIndex: 2, part: 1, totalParts: 3, skim: true });
    expect(step).toMatchObject({ skim: true, part: 1 });
    const text = guideStepContext(step!);
    expect(text).toContain("skim");
    expect(text).toContain("parts 1, 2");
  });
});

describe("resolveGuideStep", () => {
  it("takes part count and title from the open Book", () => {
    expect(resolveGuideStep(toc, { chapterIndex: 2, part: 2, totalParts: 9, chapterTitle: "stale" }))
      .toEqual({ chapterIndex: 2, part: 2, totalParts: 3, chapterTitle: "Chapter 3" });
  });

  it("rejects steps outside the Book", () => {
    expect(resolveGuideStep(toc, { chapterIndex: 2, part: 3, totalParts: 3 })).toBeNull();
    expect(resolveGuideStep(toc, { chapterIndex: 7, part: 0, totalParts: 1 })).toBeNull();
    expect(resolveGuideStep(toc, { chapterIndex: 0, part: -1, totalParts: 2 })).toBeNull();
  });
});

describe("guideStepContext", () => {
  it("names the exact read_chapter call", () => {
    const text = guideStepContext({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3" });
    expect(text).toContain("chapterIndex 2");
    expect(text).toContain("part 1");
    expect(text).toContain("0 to 2");
  });
});

describe("guideTocProgress", () => {
  it("reports covered parts, skims and the current chapter per href", () => {
    const steps = [
      { chapterIndex: 0, part: 0, totalParts: 2 },
      { chapterIndex: 0, part: 1, totalParts: 2 },
      { chapterIndex: 2, part: 0, totalParts: 3 },
      { chapterIndex: 2, part: 1, totalParts: 3, skim: true as const },
      { chapterIndex: 3, part: 0, totalParts: 1 },
    ];
    expect(guideTocProgress(toc, steps, ["c0.xhtml", "c1.xhtml", "c2.xhtml", "c3.xhtml", "missing.xhtml"])).toEqual({
      "c0.xhtml": { covered: 2, totalParts: 2, skimmed: false, current: false },
      "c2.xhtml": { covered: 3, totalParts: 3, skimmed: true, current: false },
      "c3.xhtml": { covered: 1, totalParts: 1, skimmed: false, current: true },
    });
  });

  it("counts a part read twice once", () => {
    const step = { chapterIndex: 2, part: 0, totalParts: 3 };
    expect(guideTocProgress(toc, [step, step], ["c2.xhtml"])["c2.xhtml"]).toMatchObject({ covered: 1 });
  });
});
