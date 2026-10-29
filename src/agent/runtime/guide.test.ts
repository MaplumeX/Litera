import { describe, expect, it } from "vitest";
import type { BookTocEntry, GuideBlock } from "@/agent/book/book-content";
import type { GuideStep, LegacyGuideStep } from "@/types/agent";
import { dueRecap, findGuideBlock, findableGuideBlock, guideBlockPage, guideCursor, guidedPrompt, guideOutlinePlan, guidePageMarkPlan, guideReadingState, guideRequestContext, guideSpanTo, guideStepContext, guideStepRequestFor, guideTocProgress, locateGuideStep, nextGuideSpan, recappedChapters, recordGuideSpan, requestedGuideSpan, skimGuideSpan, skipChapterSpan, stepChapters, type GuidePoint, type GuideSpan } from "./guide";

// Every part holds three blocks.
const chapter = (index: number, parts: number, chars = 1000, label = `Chapter ${index + 1}`): BookTocEntry => ({
  index, label, ancestors: [], depth: 0, hrefs: [`c${index}.xhtml`], chars, parts,
  blocks: parts * 3, partStarts: Array.from({ length: parts }, (_, part) => part * 3),
});

// Chapter 1 is a volume heading with no text of its own.
const toc = [chapter(0, 2), chapter(1, 1, 0, "Part One"), chapter(2, 3), chapter(3, 1)];

const at = (chapterIndex: number, block: number) => ({ entry: toc.find((entry) => entry.index === chapterIndex)!, block });
const span = (from: [number, number], to: [number, number], skim?: true): GuideSpan => ({ from: at(...from), to: at(...to), ...(skim ? { skim } : {}) });
/** The whole of part `part` of chapter `chapterIndex`. */
const part = (chapterIndex: number, index: number, skim?: true): GuideSpan => {
  const entry = toc.find((candidate) => candidate.index === chapterIndex)!;
  return span([chapterIndex, index * 3], [chapterIndex, skim ? entry.blocks - 1 : index * 3 + 2], skim);
};
const ends = (value: GuideSpan | null) => value && { from: [value.from.entry.index, value.from.block], to: [value.to.entry.index, value.to.block], ...(value.skim ? { skim: true } : {}) };

// Block n of chapter c opens with "c.n"; every block is a paragraph.
const blocksOf = async (chapterIndex: number): Promise<GuideBlock[]> => {
  const entry = toc.find((candidate) => candidate.index === chapterIndex)!;
  return Array.from({ length: entry.blocks }, (_, block) => ({ snippet: `${chapterIndex}.${block}`, chars: 100, heading: 0, part: Math.floor(block / 3) }));
};

describe("nextGuideSpan", () => {
  it("starts at the first part of the first chapter with text, or of the given chapter", () => {
    expect(ends(nextGuideSpan(toc, null))).toEqual({ from: [0, 0], to: [0, 2] });
    expect(ends(nextGuideSpan(toc, null, 1))).toEqual({ from: [2, 0], to: [2, 2] });
    expect(ends(nextGuideSpan(toc, null, 3))).toEqual({ from: [3, 0], to: [3, 2] });
  });

  it("goes on with the rest of the part the cursor is in, else the next part", () => {
    expect(ends(nextGuideSpan(toc, at(2, 2)))).toEqual({ from: [2, 3], to: [2, 5] });
    expect(ends(nextGuideSpan(toc, at(2, 4)))).toEqual({ from: [2, 5], to: [2, 5] });
  });

  it("crosses into the next chapter with text, ignoring the start chapter once started", () => {
    expect(ends(nextGuideSpan(toc, at(0, 5)))).toEqual({ from: [2, 0], to: [2, 2] });
    expect(ends(nextGuideSpan(toc, at(0, 2), 3))).toEqual({ from: [0, 3], to: [0, 5] });
  });

  it("returns null at the end of the Book", () => {
    expect(nextGuideSpan(toc, at(3, 2))).toBeNull();
    expect(nextGuideSpan([], null)).toBeNull();
  });
});

describe("guideCursor", () => {
  const point = (cursor: ReturnType<typeof guideCursor>) => cursor && [cursor.entry.index, cursor.block];

  it("is the furthest block the steps reached", () => {
    expect(guideCursor([])).toBeNull();
    expect(point(guideCursor([part(0, 0), part(2, 1)]))).toEqual([2, 5]);
  });

  it("stays put when the guide goes back over an earlier chapter", () => {
    expect(point(guideCursor([part(2, 0), part(2, 1), part(0, 0), null]))).toEqual([2, 5]);
  });
});

describe("locateGuideStep", () => {
  const step = (from: [number, number, string?], to: [number, number, string?], extra: Partial<GuideStep> = {}): GuideStep => ({
    from: { chapterIndex: from[0], block: from[1], ...(from[2] ? { snippet: from[2] } : {}) },
    to: { chapterIndex: to[0], block: to[1], ...(to[2] ? { snippet: to[2] } : {}) },
    ...extra,
  });

  it("finds a step's blocks by their snippets when the blocks shifted", async () => {
    expect(ends(await locateGuideStep(toc, blocksOf, step([2, 0, "2.3"], [2, 1, "2.5"], { skim: true })))).toEqual({ from: [2, 3], to: [2, 5], skim: true });
  });

  it("finds its chapter by title when the indices shifted, and clamps blocks to the chapter", async () => {
    const moved: GuideStep = { from: { chapterIndex: 3, chapterTitle: "Chapter 3", block: 0 }, to: { chapterIndex: 3, chapterTitle: "Chapter 3", block: 40 } };
    expect(ends(await locateGuideStep(toc, blocksOf, moved))).toEqual({ from: [2, 0], to: [2, 8] });
  });

  it("is null when the step no longer fits the Book", async () => {
    expect(await locateGuideStep(toc, blocksOf, step([7, 0], [7, 1]))).toBeNull();
    expect(await locateGuideStep(toc, blocksOf, step([2, 4], [2, 3]))).toBeNull();
  });

  describe("steps from before steps were block ranges", () => {
    const legacy = (chapterIndex: number, index: number, totalParts: number, extra: Partial<LegacyGuideStep> = {}): LegacyGuideStep => ({ chapterIndex, part: index, totalParts, ...extra });

    it("cover their part", async () => {
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(2, 1, 3)))).toEqual({ from: [2, 3], to: [2, 5] });
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(2, 1, 3, { skim: true })))).toEqual({ from: [2, 3], to: [2, 8], skim: true });
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(3, 0, 3, { chapterTitle: "Chapter 3" })))).toEqual({ from: [2, 0], to: [2, 2] });
    });

    it("cut for another part count, end before the first part past their share, repeating rather than skipping", async () => {
      // Chapter 3 now has 3 parts; the steps were cut for 2.
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(2, 0, 2)))).toEqual({ from: [2, 0], to: [2, 2] });
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(2, 1, 2)))).toEqual({ from: [2, 3], to: [2, 8] });
      // Chapter 1 now has 2 parts; the steps were cut for 3.
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(0, 0, 3)))).toEqual({ from: [0, 0], to: [0, 0] });
      expect(ends(await locateGuideStep(toc, blocksOf, legacy(0, 1, 3)))).toEqual({ from: [0, 0], to: [0, 2] });
    });

    it("are null when their chapter is gone", async () => {
      expect(await locateGuideStep(toc, blocksOf, legacy(9, 0, 1))).toBeNull();
    });
  });
});

describe("recordGuideSpan", () => {
  it("records the ends with snippets and paragraphs, and a whole part for its label", async () => {
    expect(await recordGuideSpan(blocksOf, part(2, 1))).toEqual({
      from: { chapterIndex: 2, chapterTitle: "Chapter 3", block: 3, snippet: "2.3", paragraph: 4 },
      to: { chapterIndex: 2, chapterTitle: "Chapter 3", block: 5, snippet: "2.5", paragraph: 6 },
      part: { index: 1, total: 3 },
    });
    expect(await recordGuideSpan(blocksOf, part(2, 1, true))).toMatchObject({ skim: true, part: { index: 1, total: 3 } });
  });

  it("leaves the part out of any other range", async () => {
    expect(await recordGuideSpan(blocksOf, span([2, 4], [2, 5]))).not.toHaveProperty("part");
    expect(await recordGuideSpan(blocksOf, span([0, 3], [2, 2]))).not.toHaveProperty("part");
  });

  it("is found again as the same span", async () => {
    for (const value of [part(0, 1), span([0, 4], [3, 1], true)]) {
      expect(ends(await locateGuideStep(toc, blocksOf, await recordGuideSpan(blocksOf, value)))).toEqual(ends(value));
    }
  });
});

describe("skims, skips and picks", () => {
  it("skim from where the step starts to the chapter's end", () => {
    expect(ends(skimGuideSpan(span([2, 4], [2, 5])))).toEqual({ from: [2, 4], to: [2, 8], skim: true });
    expect(ends(nextGuideSpan(toc, guideCursor([skimGuideSpan(span([2, 4], [2, 5]))])))).toEqual({ from: [3, 0], to: [3, 2] });
  });

  it("skip to the next chapter with text, or to the end", () => {
    expect(ends(skipChapterSpan(toc, part(0, 0)))).toEqual({ from: [2, 0], to: [2, 2] });
    expect(skipChapterSpan(toc, part(3, 0))).toBeNull();
  });

  it("run from where the step starts to the picked block, keeping a skim", () => {
    expect(ends(guideSpanTo(toc, part(2, 1), { chapterIndex: 2, block: 4 }))).toEqual({ from: [2, 3], to: [2, 4] });
    expect(ends(guideSpanTo(toc, part(2, 1), { chapterIndex: 3, block: 0 }, true))).toEqual({ from: [2, 3], to: [3, 0], skim: true });
  });

  it("refuse a pick before the step's start or outside the Book", () => {
    expect(guideSpanTo(toc, part(2, 1), { chapterIndex: 2, block: 2 })).toBeNull();
    expect(guideSpanTo(toc, part(2, 1), { chapterIndex: 0, block: 5 })).toBeNull();
    expect(guideSpanTo(toc, part(2, 1), { chapterIndex: 2, block: 9 })).toBeNull();
    expect(guideSpanTo(toc, part(2, 1), { chapterIndex: 8, block: 0 })).toBeNull();
  });
});

describe("guideStepContext", () => {
  it("names a whole part and its reads", () => {
    const text = guideStepContext(toc, part(2, 1));
    expect(text).toContain("chapterIndex 2 (\"Chapter 3\"), part 1 of 0 to 2 (blocks 3 to 5)");
    expect(text).toContain("chapterIndex 2, fromBlock 3, toBlock 5");
  });

  it("names every read of a range, split at part ends and skipping chapters without text", () => {
    const text = guideStepContext(toc, span([0, 2], [2, 4]));
    expect(text).toContain("chapterIndex 0 (\"Chapter 1\") block 2 through chapterIndex 2 (\"Chapter 3\") block 4");
    expect(text).toContain("chapterIndex 0, fromBlock 2, toBlock 2; chapterIndex 0, fromBlock 3, toBlock 5; chapterIndex 2, fromBlock 0, toBlock 2; chapterIndex 2, fromBlock 3, toBlock 4");
    expect(text).not.toContain("chapterIndex 1,");
  });

  it("asks for a compressed pass over a skim", () => {
    const text = guideStepContext(toc, part(2, 1, true));
    expect(text).toContain("skim");
    expect(text).toContain("parts 1 to 2");
    expect(text).toContain("chapterIndex 2, fromBlock 3, toBlock 5; chapterIndex 2, fromBlock 6, toBlock 8");
  });
});

describe("guideTocProgress", () => {
  it("reports covered blocks, skims and the cursor's chapter per href", () => {
    const spans = [part(0, 0), part(0, 1), part(2, 0), part(2, 1, true), part(3, 0)];
    expect(guideTocProgress(toc, spans, ["c0.xhtml", "c1.xhtml", "c2.xhtml", "c3.xhtml", "missing.xhtml"])).toEqual({
      "c0.xhtml": { coveredBlocks: 6, totalBlocks: 6, skimmed: false, current: false },
      "c2.xhtml": { coveredBlocks: 9, totalBlocks: 9, skimmed: true, current: false },
      "c3.xhtml": { coveredBlocks: 3, totalBlocks: 3, skimmed: false, current: true },
    });
  });

  it("counts blocks read twice once, across chapters, and keeps the furthest chapter current after going back", () => {
    const spans = [part(0, 0), span([0, 3], [2, 4]), part(0, 0)];
    expect(guideTocProgress(toc, spans, ["c0.xhtml", "c2.xhtml"])).toEqual({
      "c0.xhtml": { coveredBlocks: 6, totalBlocks: 6, skimmed: false, current: false },
      "c2.xhtml": { coveredBlocks: 5, totalBlocks: 9, skimmed: false, current: true },
    });
  });
});

describe("dueRecap", () => {
  const spans = [part(0, 0), part(0, 1), part(2, 0, true), part(3, 0)];

  it("is the first chapter the guide finished without a recap", () => {
    expect(dueRecap(toc, spans, new Set())).toEqual([0]);
    expect(dueRecap(toc, spans, new Set([0]))).toEqual([2]);
    expect(dueRecap(toc, spans, new Set([0, 2]))).toEqual([3]);
    expect(dueRecap(toc, spans, new Set([0, 2, 3]))).toBeNull();
  });

  it("waits for the last part of a chapter, and skips steps that no longer fit", () => {
    expect(dueRecap(toc, spans.slice(0, 1), new Set())).toBeNull();
    expect(dueRecap(toc, [null, part(2, 1)], new Set())).toBeNull();
  });

  it("groups the chapters one step finished, and keeps those of different steps apart", () => {
    expect(dueRecap(toc, [part(0, 0), span([0, 3], [3, 2])], new Set())).toEqual([0, 2, 3]);
    expect(dueRecap(toc, [part(0, 0), span([0, 3], [3, 2])], new Set([0]))).toEqual([2, 3]);
    const apart = [span([0, 0], [2, 2]), part(2, 1, true), part(3, 0)];
    expect(dueRecap(toc, apart, new Set())).toEqual([0]);
    expect(dueRecap(toc, apart, new Set([0]))).toEqual([2]);
    expect(dueRecap(toc, apart, new Set([0, 2]))).toEqual([3]);
  });

  it("names the chapters a step covers", () => {
    expect(stepChapters(toc, span([0, 3], [2, 4]))).toEqual([0, 2]);
    expect(stepChapters(toc, null)).toEqual([]);
  });
});

describe("recappedChapters", () => {
  it("count every chapter with text in a recap's range as recapped", () => {
    expect(recappedChapters(toc, [{ chapterIndex: 0, throughChapterIndex: 2 }, { chapterIndex: 3 }])).toEqual(new Set([0, 2, 3]));
    // Found by title when the indices shifted.
    expect(recappedChapters(toc, [{ chapterIndex: 5, chapterTitle: "Chapter 3", throughChapterIndex: 6, throughChapterTitle: "Chapter 4" }])).toEqual(new Set([2, 3]));
    expect(recappedChapters(toc, [{ chapterIndex: 9 }])).toEqual(new Set());
  });
});

describe("guideOutlinePlan", () => {
  const long = [chapter(0, 2), chapter(1, 1, 0, "Part One"), chapter(2, 3), chapter(3, 1), chapter(4, 1), chapter(5, 1)];

  it("starts at the step's first block and skips chapters without text", () => {
    expect(guideOutlinePlan(long, part(0, 1), undefined, 10)).toEqual({
      chapters: [
        { chapterIndex: 0, chapterTitle: "Chapter 1", firstBlock: 3 },
        { chapterIndex: 2, chapterTitle: "Chapter 3", firstBlock: 0 },
      ],
      more: 2,
    });
  });

  it("continues after a chapter, and ends at the Book's end", () => {
    expect(guideOutlinePlan(long, part(0, 1), 2, 10)).toEqual({
      chapters: [3, 4, 5].map((index) => ({ chapterIndex: index, chapterTitle: `Chapter ${index + 1}`, firstBlock: 0 })),
      more: null,
    });
  });
});

describe("guidePageMarkPlan", () => {
  it("lists read and skimmed blocks per chapter, its files, and the Guide cursor", () => {
    expect(guidePageMarkPlan(toc, [part(0, 0), span([0, 3], [2, 1]), part(2, 0, true), part(0, 0)])).toEqual([
      { chapterIndex: 0, files: ["c0.xhtml"], read: [0, 1, 2, 3, 4, 5], skimmed: [] },
      { chapterIndex: 2, files: ["c2.xhtml"], read: [0, 1], skimmed: [2, 3, 4, 5, 6, 7, 8], cursor: 8 },
    ]);
  });

  it("is empty before the first step", () => {
    expect(guidePageMarkPlan(toc, [])).toEqual([]);
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

describe("findableGuideBlock", () => {
  const block = (snippet: string, kind?: "image" | "blank") => ({ snippet, chars: snippet.length, heading: 0, part: 0, ...(kind ? { kind } : {}) });
  const blocks = [block("Chapter One"), block("一"), block("", "image"), block("", "blank"), block("The opening line.")];

  it("keeps a block with enough text", () => {
    expect(findableGuideBlock(blocks, 0)).toBe(0);
  });

  it("skips short headings, images and blanks", () => {
    expect(findableGuideBlock(blocks, 1)).toBe(4);
  });

  it("is null when nothing from the start can be found", () => {
    expect(findableGuideBlock(blocks.slice(0, 4), 1)).toBeNull();
    expect(findableGuideBlock(blocks, 9)).toBeNull();
  });
});

describe("guideBlockPage", () => {
  const blocks = [
    { snippet: "Chapter 1", chars: 9, heading: 2, part: 0 },
    { snippet: "First paragraph", chars: 300, heading: 0, part: 0 },
    { snippet: "", chars: 0, heading: 0, part: 0, kind: "image" as const },
    { snippet: "Second paragraph", chars: 200, heading: 0, part: 1 },
  ];

  it("numbers blocks from 0 and keeps heading levels and kinds only where they apply", () => {
    expect(guideBlockPage(toc[0], blocks)).toEqual({
      chapterIndex: 0, chapterTitle: "Chapter 1", totalBlocks: 4, next: null,
      blocks: [
        { block: 0, part: 0, chars: 9, snippet: "Chapter 1", heading: 2 },
        { block: 1, paragraph: 1, part: 0, chars: 300, snippet: "First paragraph" },
        { block: 2, part: 0, chars: 0, snippet: "", kind: "image" },
        { block: 3, paragraph: 2, part: 1, chars: 200, snippet: "Second paragraph" },
      ],
    });
  });

  it("pages from fromBlock and says where the next page starts", () => {
    const first = guideBlockPage(toc[0], blocks, 0, 3);
    expect(first.blocks.map((block) => block.block)).toEqual([0, 1, 2]);
    expect(first.next).toBe(3);
    const second = guideBlockPage(toc[0], blocks, first.next!, 3);
    expect(second.blocks.map((block) => block.block)).toEqual([3]);
    // A later page counts on from the paragraphs before it.
    expect(second.blocks[0].paragraph).toBe(2);
    expect(second.next).toBeNull();
  });

  it("returns no blocks past the chapter's end", () => {
    expect(guideBlockPage(toc[0], blocks, 10)).toMatchObject({ blocks: [], next: null });
  });
});

describe("requestedGuideSpan", () => {
  const cursor = at(0, 2);
  const taken = (request: Parameters<typeof requestedGuideSpan>[2], from: GuidePoint | null = cursor) => {
    const result = requestedGuideSpan(toc, from, request);
    return "span" in result ? ends(result.span) : result;
  };

  it("takes the default step from the cursor, or from a chapter's start", () => {
    expect(taken({})).toEqual({ from: [0, 3], to: [0, 5] });
    expect(taken({ chapterIndex: 2 })).toEqual({ from: [2, 0], to: [2, 2] });
  });

  it("goes back over an earlier chapter when asked", () => {
    expect(taken({ chapterIndex: 0 }, at(2, 5))).toEqual({ from: [0, 0], to: [0, 2] });
  });

  it("starts at the next chapter with text when the named one has none", () => {
    expect(taken({ chapterIndex: 1 }, null)).toEqual({ from: [2, 0], to: [2, 2] });
  });

  it("ends at a block of the start's chapter, of another chapter, or at a chapter's end", () => {
    expect(taken({ chapterIndex: 2, toBlock: 1 })).toEqual({ from: [2, 0], to: [2, 1] });
    expect(taken({ toChapterIndex: 2, toBlock: 4 })).toEqual({ from: [0, 3], to: [2, 4] });
    expect(taken({ chapterIndex: 2, toChapterIndex: 2 }, null)).toEqual({ from: [2, 0], to: [2, 8] });
  });

  it("skims the default range or the asked one", () => {
    expect(taken({ chapterIndex: 2, skim: true }, null)).toEqual({ from: [2, 0], to: [2, 8], skim: true });
    expect(taken({ chapterIndex: 2, toBlock: 4, skim: true }, null)).toEqual({ from: [2, 0], to: [2, 4], skim: true });
  });

  it("refuses unknown chapters, blocks outside the chapter, ends before the start, and the end of the book", () => {
    expect(taken({ chapterIndex: 9 })).toEqual({ error: "No chapter with chapterIndex 9" });
    expect(taken({ toChapterIndex: 9, toBlock: 0 })).toEqual({ error: "No chapter with chapterIndex 9" });
    expect(taken({ toBlock: 6 })).toMatchObject({ error: expect.stringContaining("blocks 0 to 5") });
    expect(taken({ toBlock: 1 })).toMatchObject({ error: expect.stringContaining("never mid-chapter") });
    expect(taken({}, at(3, 2))).toEqual({ error: "The guide has reached the end of the book" });
  });
});

describe("guidedPrompt", () => {
  it("makes guide_step the one way the guide moves on, and leaves its rules to the tool", () => {
    const prompt = guidedPrompt();
    expect(prompt).toContain("guide_step is how the guide moves on");
    expect(prompt).toContain("reading state");
    expect(prompt).not.toContain("side question");
    expect(prompt).not.toContain("mid-chapter");
    expect(prompt).not.toContain("list_guide_blocks");
  });

  it("keeps the mechanics when the reader's style replaces the default", () => {
    const prompt = guidedPrompt("Use a table.");
    expect(prompt).toContain("guide_step is how the guide moves on");
    expect(prompt).toContain("Use a table.");
    expect(prompt).not.toContain("Cover the part completely");
  });
});

describe("guideReadingState", () => {
  it("says how far the guide has got and what Continue would read", () => {
    const text = guideReadingState(at(2, 2), nextGuideSpan(toc, at(2, 2)));
    expect(text).toContain("reached chapterIndex 2 (\"Chapter 3\"), block 2 of 0 to 8 (the furthest it has been)");
    expect(text).toContain("default next step: chapterIndex 2 (\"Chapter 3\"), part 1 of 0 to 2 (blocks 3 to 5)");
  });

  it("says when the guide has not started or has reached the end", () => {
    expect(guideReadingState(null, nextGuideSpan(toc, null))).toContain("has not started yet");
    expect(guideReadingState(at(3, 2), null)).toContain("end of the book");
  });
});

describe("guideStepRequestFor", () => {
  const cursor = at(2, 2);
  // Whatever the reader picked, the guide_step call it maps to takes that same step.
  const roundTrip = (picked: GuideSpan, from: GuidePoint | null = cursor) => {
    const request = guideStepRequestFor(toc, from, picked);
    expect(request).not.toBeNull();
    const taken = requestedGuideSpan(toc, from, request!);
    expect("span" in taken && ends(taken.span)).toEqual(ends(picked));
    return request;
  };

  it("leaves the start out when the step goes on from the cursor", () => {
    const next = nextGuideSpan(toc, cursor)!;
    expect(roundTrip(next)).toEqual({});
    expect(roundTrip(skimGuideSpan(next))).toEqual({ skim: true });
    expect(roundTrip(guideSpanTo(toc, next, { chapterIndex: 3, block: 1 })!)).toEqual({ toChapterIndex: 3, toBlock: 1 });
  });

  it("names the chapter of a step picked elsewhere, as the TOC or skipping picks it", () => {
    expect(roundTrip(nextGuideSpan(toc, null, 3)!)).toEqual({ chapterIndex: 3 });
    expect(roundTrip(skipChapterSpan(toc, nextGuideSpan(toc, cursor)!)!)).toEqual({ chapterIndex: 3 });
    expect(roundTrip(nextGuideSpan(toc, null, 2)!, null)).toEqual({ chapterIndex: 2 });
    expect(roundTrip(part(0, 0))).toEqual({ chapterIndex: 0 });
  });

  it("refuses a step no call can take: mid-chapter, away from the cursor", () => {
    expect(guideStepRequestFor(toc, cursor, span([2, 5], [2, 6]))).toBeNull();
    expect(guideRequestContext(toc, cursor, span([2, 5], [2, 6]))).toBeNull();
  });

  it("tells the model the exact call for a picked step, and leaves Continue's end to it", () => {
    expect(guideRequestContext(toc, cursor, nextGuideSpan(toc, null, 3)!)).toContain('guide_step {"chapterIndex":3}');
    expect(guideRequestContext(toc, cursor)).toContain("natural break");
  });
});
