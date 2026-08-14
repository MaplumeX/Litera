import assert from "node:assert/strict";
import test from "node:test";
import {
  assignChapterOwners,
  buildOwnedChapters,
  canonicalHref,
  findChapterByHref,
  formatChapterAside,
  hrefMatches,
  mergeOwnedChapters,
} from "../chapter-ownership.ts";

test("canonicalHref strips fragment, decodes, and leading ../ and /", () => {
  assert.equal(canonicalHref("OEBPS/ch1.xhtml#start"), "OEBPS/ch1.xhtml");
  assert.equal(canonicalHref("../Text/ch%201.xhtml"), "Text/ch 1.xhtml");
  assert.equal(canonicalHref("/OEBPS/ch1.xhtml"), "OEBPS/ch1.xhtml");
});

test("hrefMatches requires a path-boundary suffix", () => {
  assert.equal(hrefMatches("OEBPS/Text/ch1.xhtml", "ch1.xhtml"), true);
  assert.equal(hrefMatches("Text/ch1.xhtml#foo", "OEBPS/Text/ch1.xhtml"), true);
  assert.equal(hrefMatches("part0010.html", "0.html"), false);
  assert.equal(hrefMatches("OEBPS/part0010.html", "0.html"), false);
});

test("cover file stays unowned; split spine files join the previous TOC owner", () => {
  const spine = ["OEBPS/cover.xhtml", "OEBPS/ch1a.xhtml", "OEBPS/ch1b.xhtml", "OEBPS/ch2.xhtml"];
  const owners = assignChapterOwners(spine, ["OEBPS/ch1a.xhtml", "OEBPS/ch2.xhtml"]);
  assert.deepEqual(owners, [undefined, 0, 0, 1]);

  const chapters = mergeOwnedChapters(
    [
      { label: "Chapter One", href: "OEBPS/ch1a.xhtml" },
      { label: "Chapter Two", href: "OEBPS/ch2.xhtml" },
    ],
    spine,
    ["COVER TEXT", "one-a ", "one-b", "two"],
    owners,
  );
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].label, "Chapter One");
  assert.equal(chapters[0].text, "one-a one-b");
  assert.ok(chapters[0].hrefs.includes("OEBPS/ch1a.xhtml"));
  assert.ok(chapters[0].hrefs.includes("OEBPS/ch1b.xhtml"));
  assert.equal(chapters[1].text, "two");
  assert.equal(chapters[0].text.includes("COVER"), false);
});

test("empty or unresolvable TOC falls back to one chapter per non-empty spine file", () => {
  const spine = ["OEBPS/a.xhtml", "OEBPS/b.xhtml", "OEBPS/empty.xhtml"];
  const texts = ["alpha", "bravo", ""];
  const empty = buildOwnedChapters([], spine, texts);
  assert.equal(empty.length, 2);
  assert.deepEqual(empty[0].hrefs, ["OEBPS/a.xhtml"]);
  assert.equal(empty[0].label, "");
  assert.equal(empty[1].text, "bravo");

  const unresolved = buildOwnedChapters(
    [{ label: "Ghost", href: "missing.xhtml" }],
    spine,
    texts,
  );
  assert.equal(unresolved.length, 2);
  assert.deepEqual(unresolved.map((chapter) => chapter.hrefs[0]), ["OEBPS/a.xhtml", "OEBPS/b.xhtml"]);
});

test("findChapterByHref matches TOC href and spine id", () => {
  const chapters = [
    { index: 0, label: "One", hrefs: ["Text/ch1.xhtml", "OEBPS/Text/ch1.xhtml", "OEBPS/Text/ch1-cont.xhtml"] },
    { index: 1, label: "Two", hrefs: ["OEBPS/Text/ch2.xhtml"] },
  ];
  assert.equal(findChapterByHref(chapters, "Text/ch1.xhtml#frag")?.index, 0);
  assert.equal(findChapterByHref(chapters, "OEBPS/Text/ch1-cont.xhtml")?.index, 0);
  assert.equal(findChapterByHref(chapters, "OEBPS/Text/ch2.xhtml")?.index, 1);
  assert.equal(findChapterByHref(chapters, "nope.xhtml"), undefined);
  assert.equal(findChapterByHref(chapters, undefined), undefined);
});

test("formatChapterAside names title and chapterNumber, never a raw spine integer", () => {
  assert.equal(
    formatChapterAside({ index: 0, label: "Loomings" }),
    "（当前在「Loomings」，第 1 章）",
  );
  assert.equal(formatChapterAside({ index: 2, label: "  " }), "（当前在第 3 章）");
  assert.equal(formatChapterAside(undefined), undefined);
});
