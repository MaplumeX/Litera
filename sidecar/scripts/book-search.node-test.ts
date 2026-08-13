import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_PART_CHARS,
  SEARCH_HIT_LIMIT,
  searchChapters,
  toSearchToolHit,
  windowChapterText,
} from "../book-text.ts";

test("windowChapterText slices 25000 chars and clamps an out-of-range part", () => {
  const text = "a".repeat(25000);
  const part0 = windowChapterText(text, 0);
  assert.equal(part0.part, 0);
  assert.equal(part0.totalParts, 3);
  assert.equal(part0.text.length, CHAPTER_PART_CHARS);

  const part2 = windowChapterText(text, 2);
  assert.equal(part2.part, 2);
  assert.equal(part2.totalParts, 3);
  assert.equal(part2.text.length, 1000);
  assert.equal(part2.text, text.slice(2 * CHAPTER_PART_CHARS));

  const clamped = windowChapterText(text, 99);
  assert.equal(clamped.part, 2);
  assert.equal(clamped.totalParts, 3);
  assert.equal(clamped.text, part2.text);
});

test("searchChapters merges multiple queries in one pass", () => {
  const chapters = [
    { title: "Alpha", text: "alpha appears here" },
    { title: "Bravo", text: "bravo appears here" },
  ];
  const hits = searchChapters(chapters, ["alpha", "bravo"]);
  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((hit) => ({ chapterIndex: hit.chapterIndex, match: hit.match, chapterTitle: hit.chapterTitle })),
    [
      { chapterIndex: 0, match: "exact", chapterTitle: "Alpha" },
      { chapterIndex: 1, match: "exact", chapterTitle: "Bravo" },
    ],
  );
});

test("searchChapters caps merged hits at 16", () => {
  const chapters = Array.from({ length: 20 }, (_, index) => ({
    title: `C${index}`,
    text: `hello token world ${index}`,
  }));
  const hits = searchChapters(chapters, ["token"]);
  assert.equal(hits.length, SEARCH_HIT_LIMIT);
  assert.equal(hits.every((hit) => hit.match === "exact"), true);
});

test("searchChapters prefers exact hits and marks token-AND fallback as partial", () => {
  const chapters = [
    { title: "Exact", text: "exact phrase here" },
    { title: "Partial", text: "the white whale swims north" },
  ];
  const hits = searchChapters(chapters, ["bar foo", "exact phrase"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, "exact");
  assert.equal(hits[0].chapterIndex, 0);

  const mixed = searchChapters(chapters, ["whale white", "exact phrase"]);
  assert.equal(mixed.length, 2);
  assert.equal(mixed[0].match, "exact");
  assert.equal(mixed[0].chapterIndex, 0);
  assert.equal(mixed[1].match, "partial");
  assert.equal(mixed[1].chapterIndex, 1);
  assert.equal(mixed[1].chapterTitle, "Partial");
});

test("searchChapters reports part 1 for a match past 12000 chars", () => {
  const chapters = [{
    title: "Long",
    text: `${"x".repeat(CHAPTER_PART_CHARS)}needle in the haystack`,
  }];
  const hits = searchChapters(chapters, ["needle"]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].offset, CHAPTER_PART_CHARS);
  const toolHit = toSearchToolHit(hits[0]);
  assert.equal(toolHit.part, 1);
  assert.equal(toolHit.match, "exact");
  assert.equal(toolHit.chapterTitle, "Long");
  assert.match(toolHit.snippet, /needle/);
});
