import { describe, expect, it } from "vitest";
import type { BookTocEntry } from "@/agent/book/book-content";
import type { GuidePosition, GuideStep } from "@/types/agent";
import { dueRecap, findGuideBlock, guidePageMarkPlan, recappedChapters, guideOutlinePlan, guideStepContext, guideStepTo, guideTocProgress, nextGuideStep, resolveGuideStep, skimGuideStep, skipChapterStep, stepChapters } from "./guide";

// Every part holds three blocks.
const chapter = (index: number, parts: number, chars = 1000, label = `Chapter ${index + 1}`): BookTocEntry => ({
  index, label, ancestors: [], depth: 0, hrefs: [`c${index}.xhtml`], chars, parts,
  blocks: parts * 3, partStarts: Array.from({ length: parts }, (_, part) => part * 3),
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

describe("cursors from an older part count", () => {
  it("continues from the matching share of the chapter, repeating rather than skipping", () => {
    // Chapter 3 now has 3 parts; the cursor was cut for 2.
    expect(nextGuideStep(toc, { chapterIndex: 2, part: 0, totalParts: 2 })).toMatchObject({ chapterIndex: 2, part: 1 });
    expect(nextGuideStep(toc, { chapterIndex: 2, part: 1, totalParts: 2 })).toMatchObject({ chapterIndex: 3, part: 0 });
    // Chapter 1 now has 2 parts; the cursor was cut for 3.
    expect(nextGuideStep(toc, { chapterIndex: 0, part: 0, totalParts: 3 })).toMatchObject({ chapterIndex: 0, part: 0 });
    expect(nextGuideStep(toc, { chapterIndex: 0, part: 1, totalParts: 3 })).toMatchObject({ chapterIndex: 0, part: 1 });
  });

  it("counts the old steps of a whole chapter as the whole chapter", () => {
    const steps = [0, 1].map((part) => ({ chapterIndex: 2, part, totalParts: 2 }));
    expect(guideTocProgress(toc, steps, ["c2.xhtml"])["c2.xhtml"]).toMatchObject({ coveredBlocks: 9, totalBlocks: 9 });
  });
});

describe("cursors from older chapter indices", () => {
  it("finds the chapter by its recorded title when the indices shifted", () => {
    // "Chapter 3" was index 3 when the step was sent; it is index 2 now.
    expect(nextGuideStep(toc, { chapterIndex: 3, part: 0, totalParts: 3, chapterTitle: "Chapter 3" })).toMatchObject({ chapterIndex: 2, part: 1 });
    expect(guideTocProgress(toc, [{ chapterIndex: 3, part: 0, totalParts: 3, chapterTitle: "Chapter 3" }], ["c2.xhtml", "c3.xhtml"])).toEqual({
      "c2.xhtml": { coveredBlocks: 3, totalBlocks: 9, skimmed: false, current: true },
    });
  });

  it("keeps the index when the title is missing or ambiguous", () => {
    const twins = [chapter(0, 1, 1000, "Notes"), chapter(1, 1, 1000, "Notes"), chapter(2, 1)];
    expect(nextGuideStep(twins, { chapterIndex: 2, part: 0, totalParts: 1, chapterTitle: "Notes" })).toBeNull();
    expect(nextGuideStep(toc, { chapterIndex: 0, part: 1, totalParts: 2 })).toMatchObject({ chapterIndex: 2 });
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
    const text = guideStepContext(toc, step!);
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
    const text = guideStepContext(toc, { chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3" });
    expect(text).toContain("chapterIndex 2");
    expect(text).toContain("part 1");
    expect(text).toContain("0 to 2");
  });
});

describe("guideTocProgress", () => {
  it("reports covered blocks, skims and the current chapter per href", () => {
    const steps = [
      { chapterIndex: 0, part: 0, totalParts: 2 },
      { chapterIndex: 0, part: 1, totalParts: 2 },
      { chapterIndex: 2, part: 0, totalParts: 3 },
      { chapterIndex: 2, part: 1, totalParts: 3, skim: true as const },
      { chapterIndex: 3, part: 0, totalParts: 1 },
    ];
    expect(guideTocProgress(toc, steps, ["c0.xhtml", "c1.xhtml", "c2.xhtml", "c3.xhtml", "missing.xhtml"])).toEqual({
      "c0.xhtml": { coveredBlocks: 6, totalBlocks: 6, skimmed: false, current: false },
      "c2.xhtml": { coveredBlocks: 9, totalBlocks: 9, skimmed: true, current: false },
      "c3.xhtml": { coveredBlocks: 3, totalBlocks: 3, skimmed: false, current: true },
    });
  });

  it("counts a part read twice once", () => {
    const step = { chapterIndex: 2, part: 0, totalParts: 3 };
    expect(guideTocProgress(toc, [step, step], ["c2.xhtml"])["c2.xhtml"]).toMatchObject({ coveredBlocks: 3 });
  });
});

describe("dueRecap", () => {
  const steps = [
    { chapterIndex: 0, part: 0, totalParts: 2 },
    { chapterIndex: 0, part: 1, totalParts: 2 },
    { chapterIndex: 2, part: 0, totalParts: 3, skim: true as const },
    { chapterIndex: 3, part: 0, totalParts: 1 },
  ];

  it("is the first chapter the guide finished without a recap", () => {
    expect(dueRecap(toc, steps, new Set())).toEqual([0]);
    expect(dueRecap(toc, steps, new Set([0]))).toEqual([2]);
    expect(dueRecap(toc, steps, new Set([0, 2]))).toEqual([3]);
    expect(dueRecap(toc, steps, new Set([0, 2, 3]))).toBeNull();
  });

  it("waits for the last part of a chapter", () => {
    expect(dueRecap(toc, steps.slice(0, 1), new Set())).toBeNull();
    expect(dueRecap(toc, [{ chapterIndex: 2, part: 1, totalParts: 3 }], new Set())).toBeNull();
  });
});

const at = (chapterIndex: number, block: number): GuidePosition => ({ chapterIndex, block });
const ranged = (from: GuidePosition, to: GuidePosition, extra: Partial<GuideStep> = {}): GuideStep => {
  const entry = toc.find((candidate) => candidate.index === from.chapterIndex)!;
  return { chapterIndex: from.chapterIndex, part: Math.floor(from.block / 3), totalParts: entry.parts, range: { from, to }, ...extra };
};

describe("range steps", () => {
  it("continue with the rest of the part a range ended in", () => {
    expect(nextGuideStep(toc, ranged(at(2, 0), at(2, 4)))).toEqual({
      chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3",
      range: { from: { chapterIndex: 2, chapterTitle: "Chapter 3", block: 5 }, to: { chapterIndex: 2, chapterTitle: "Chapter 3", block: 5 } },
    });
    expect(nextGuideStep(toc, ranged(at(0, 2), at(3, 0)))).toMatchObject({ chapterIndex: 3, range: { from: { block: 1 }, to: { block: 2 } } });
  });

  it("continue with the next whole part, or chapter, when a range ends at a part's end", () => {
    expect(nextGuideStep(toc, ranged(at(2, 1), at(2, 5)))).toEqual({ chapterIndex: 2, part: 2, totalParts: 3, chapterTitle: "Chapter 3" });
    expect(nextGuideStep(toc, ranged(at(0, 4), at(2, 8)))).toEqual({ chapterIndex: 3, part: 0, totalParts: 1, chapterTitle: "Chapter 4" });
    expect(nextGuideStep(toc, ranged(at(3, 1), at(3, 2)))).toBeNull();
  });

  it("resolve against the open Book, as whole parts when they are", () => {
    expect(resolveGuideStep(toc, ranged(at(0, 1), at(2, 4)))).toMatchObject({
      chapterIndex: 0, part: 0, totalParts: 2, range: { from: { chapterIndex: 0, block: 1 }, to: { chapterIndex: 2, block: 4 } },
    });
    expect(resolveGuideStep(toc, ranged(at(2, 3), at(2, 5)))).toEqual({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3" });
    expect(resolveGuideStep(toc, ranged(at(2, 3), at(2, 8), { skim: true }))).toEqual({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3", skim: true });
    expect(resolveGuideStep(toc, ranged(at(2, 3), at(2, 5), { skim: true }))).toMatchObject({ skim: true, range: { from: { block: 3 }, to: { block: 5 } } });
  });

  it("reject ranges outside the Book or running backwards", () => {
    expect(resolveGuideStep(toc, ranged(at(2, 4), at(2, 3)))).toBeNull();
    expect(resolveGuideStep(toc, ranged(at(2, 0), at(0, 5)))).toBeNull();
    expect(resolveGuideStep(toc, ranged(at(2, 0), at(2, 9)))).toBeNull();
    expect(resolveGuideStep(toc, ranged(at(2, 0), at(7, 0)))).toBeNull();
  });

  it("name every read, split at part ends and skipping chapters without text", () => {
    const text = guideStepContext(toc, resolveGuideStep(toc, ranged(at(0, 2), at(2, 4)))!);
    expect(text).toContain("chapterIndex 0 (\"Chapter 1\") block 2 through chapterIndex 2 (\"Chapter 3\") block 4");
    expect(text).toContain("chapterIndex 0, fromBlock 2, toBlock 2; chapterIndex 0, fromBlock 3, toBlock 5; chapterIndex 2, fromBlock 0, toBlock 2; chapterIndex 2, fromBlock 3, toBlock 4");
    expect(text).not.toContain("chapterIndex 1,");
    const skim = guideStepContext(toc, resolveGuideStep(toc, ranged(at(2, 1), at(2, 2), { skim: true }))!);
    expect(skim).toContain("skim");
    expect(skim).toContain("chapterIndex 2, fromBlock 1, toBlock 2");
  });

  it("count every block they cover, across chapters", () => {
    const steps = [{ chapterIndex: 0, part: 0, totalParts: 2 }, ranged(at(0, 3), at(2, 4))];
    expect(guideTocProgress(toc, steps, ["c0.xhtml", "c1.xhtml", "c2.xhtml"])).toEqual({
      "c0.xhtml": { coveredBlocks: 6, totalBlocks: 6, skimmed: false, current: false },
      "c2.xhtml": { coveredBlocks: 5, totalBlocks: 9, skimmed: false, current: true },
    });
    expect(dueRecap(toc, steps, new Set())).toEqual([0]);
    expect(dueRecap(toc, steps, new Set([0]))).toBeNull();
    expect(stepChapters(toc, steps[1])).toEqual([0, 2]);
    expect(stepChapters(toc, steps[0])).toEqual([0]);
  });

  it("skim from where they start to the chapter's end", () => {
    expect(skimGuideStep(toc, { chapterIndex: 2, part: 1, totalParts: 3 })).toEqual({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3", skim: true });
    expect(skimGuideStep(toc, ranged(at(2, 4), at(2, 5)))).toMatchObject({ skim: true, range: { from: { block: 4 }, to: { chapterIndex: 2, block: 8 } } });
    expect(nextGuideStep(toc, skimGuideStep(toc, ranged(at(2, 4), at(2, 5)))!)).toMatchObject({ chapterIndex: 3, part: 0 });
  });

  it("skip to the chapter after the one they start in", () => {
    expect(skipChapterStep(toc, ranged(at(2, 4), at(2, 5)))).toEqual({ chapterIndex: 3, part: 0, totalParts: 1, chapterTitle: "Chapter 4" });
  });

  it("clamp recorded blocks to a chapter that has fewer now", () => {
    expect(nextGuideStep(toc, ranged(at(3, 0), at(3, 40)))).toBeNull();
    expect(guideTocProgress(toc, [ranged(at(3, 0), at(3, 40))], ["c3.xhtml"])["c3.xhtml"]).toMatchObject({ coveredBlocks: 3 });
  });
});

describe("findGuideBlock", () => {
  const blocks = ["Title", "It was", "a dark night", "It was"].map((snippet) => ({ snippet }));

  it("keeps the block whose snippet still matches, or that has none", () => {
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 3, snippet: "It was" })).toBe(3);
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 2 })).toBe(2);
  });

  it("moves to the nearest block with the snippet when the blocks shifted", () => {
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 0, snippet: "It was" })).toBe(1);
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 5, snippet: "It was" })).toBe(3);
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 1, snippet: "a dark night" })).toBe(2);
  });

  it("keeps the recorded block when no block has the snippet", () => {
    expect(findGuideBlock(blocks, { chapterIndex: 0, block: 2, snippet: "gone" })).toBe(2);
  });
});

describe("guideStepTo", () => {
  it("runs from where the step starts to the picked block", () => {
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(2, 4))).toMatchObject({
      chapterIndex: 2, part: 1, range: { from: { chapterIndex: 2, block: 3 }, to: { chapterIndex: 2, block: 4 } },
    });
    expect(guideStepTo(toc, ranged(at(0, 1), at(0, 2)), at(3, 2))).toMatchObject({ range: { from: { chapterIndex: 0, block: 1 }, to: { chapterIndex: 3, block: 2 } } });
  });

  it("is a plain part step when the pick ends the part, and keeps a skim", () => {
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(2, 5))).toEqual({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3" });
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(2, 8), true)).toEqual({ chapterIndex: 2, part: 1, totalParts: 3, chapterTitle: "Chapter 3", skim: true });
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(3, 0), true)).toMatchObject({ skim: true, range: { to: { chapterIndex: 3, block: 0 } } });
  });

  it("refuses a pick before the step's start or outside the Book", () => {
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(2, 2))).toBeNull();
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(0, 5))).toBeNull();
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(2, 9))).toBeNull();
    expect(guideStepTo(toc, { chapterIndex: 2, part: 1, totalParts: 3 }, at(8, 0))).toBeNull();
  });
});

describe("guideOutlinePlan", () => {
  const long = [chapter(0, 2), chapter(1, 1, 0, "Part One"), chapter(2, 3), chapter(3, 1), chapter(4, 1), chapter(5, 1)];

  it("starts at the step's first block and skips chapters without text", () => {
    expect(guideOutlinePlan(long, { chapterIndex: 0, part: 1, totalParts: 2 }, undefined, 10)).toEqual({
      chapters: [
        { chapterIndex: 0, chapterTitle: "Chapter 1", firstBlock: 3 },
        { chapterIndex: 2, chapterTitle: "Chapter 3", firstBlock: 0 },
      ],
      more: 2,
    });
  });

  it("continues after a chapter, and ends at the Book's end", () => {
    expect(guideOutlinePlan(long, { chapterIndex: 0, part: 1, totalParts: 2 }, 2, 10)).toEqual({
      chapters: [3, 4, 5].map((index) => ({ chapterIndex: index, chapterTitle: `Chapter ${index + 1}`, firstBlock: 0 })),
      more: null,
    });
  });

  it("is empty when the step no longer fits the Book", () => {
    expect(guideOutlinePlan(long, { chapterIndex: 9, part: 0, totalParts: 1 })).toEqual({ chapters: [], more: null });
  });
});

describe("grouped recaps", () => {
  it("group the chapters one step finished", () => {
    const steps = [{ chapterIndex: 0, part: 0, totalParts: 2 }, ranged(at(0, 3), at(3, 2))];
    expect(dueRecap(toc, steps, new Set())).toEqual([0, 2, 3]);
    expect(dueRecap(toc, steps, new Set([0]))).toEqual([2, 3]);
  });

  it("keep chapters finished by different steps apart", () => {
    const steps = [ranged(at(0, 0), at(2, 2)), { chapterIndex: 2, part: 1, totalParts: 3, skim: true as const }, { chapterIndex: 3, part: 0, totalParts: 1 }];
    expect(dueRecap(toc, steps, new Set())).toEqual([0]);
    expect(dueRecap(toc, steps, new Set([0]))).toEqual([2]);
    expect(dueRecap(toc, steps, new Set([0, 2]))).toEqual([3]);
  });

  it("count every chapter with text in a recap's range as recapped", () => {
    expect(recappedChapters(toc, [{ chapterIndex: 0, throughChapterIndex: 2 }, { chapterIndex: 3 }])).toEqual(new Set([0, 2, 3]));
    // Found by title when the indices shifted.
    expect(recappedChapters(toc, [{ chapterIndex: 5, chapterTitle: "Chapter 3", throughChapterIndex: 6, throughChapterTitle: "Chapter 4" }])).toEqual(new Set([2, 3]));
    expect(recappedChapters(toc, [{ chapterIndex: 9 }])).toEqual(new Set());
  });
});

describe("guidePageMarkPlan", () => {
  it("lists read and skimmed blocks per chapter, its files, and where the guide stands", () => {
    const steps = [{ chapterIndex: 0, part: 0, totalParts: 2 }, ranged(at(0, 3), at(2, 1)), { chapterIndex: 2, part: 0, totalParts: 3, skim: true as const }];
    expect(guidePageMarkPlan(toc, steps)).toEqual([
      { chapterIndex: 0, files: ["c0.xhtml"], read: [0, 1, 2, 3, 4, 5], skimmed: [] },
      { chapterIndex: 2, files: ["c2.xhtml"], read: [0, 1], skimmed: [2, 3, 4, 5, 6, 7, 8], cursor: 8 },
    ]);
  });

  it("is empty before the first step", () => {
    expect(guidePageMarkPlan(toc, [])).toEqual([]);
  });
});
