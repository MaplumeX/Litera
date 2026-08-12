import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOK_SNAPSHOT_CUSTOM_TYPE,
  BOOK_SNAPSHOT_MAX_TOC_CHARS,
  BOOK_SNAPSHOT_MAX_TOC_ENTRIES,
  formatBookSnapshot,
  sessionHasBookSnapshot,
} from "../book-snapshot.ts";

const meta = {
  title: "Moby-Dick",
  author: "Herman Melville",
  language: "en",
  totalChapters: 3,
};

test("short TOC is complete with no truncated note and no hrefs", () => {
  const toc = [
    { index: 0, label: "Loomings", href: "ch1.xhtml" },
    { index: 1, label: "The Carpet-Bag", href: "ch2.xhtml" },
    { index: 2, label: "The Spouter-Inn", href: "ch3.xhtml" },
  ];
  const text = formatBookSnapshot(meta, toc);
  assert.match(text, /^Book snapshot \(already provided; do not call get_book_metadata or get_toc unless the TOC is truncated or you need hrefs\):/);
  assert.match(text, /Title: Moby-Dick/);
  assert.match(text, /Author: Herman Melville/);
  assert.match(text, /Language: en/);
  assert.match(text, /Total chapters: 3/);
  assert.match(text, /Table of Contents \(3 of 3 entries\):/);
  assert.match(text, /0: Loomings/);
  assert.match(text, /1: The Carpet-Bag/);
  assert.match(text, /2: The Spouter-Inn/);
  assert.equal(text.includes("ch1.xhtml"), false);
  assert.equal(text.includes("ch2.xhtml"), false);
  assert.equal(text.includes("ch3.xhtml"), false);
  assert.equal(text.includes("[TOC truncated."), false);
});

test("201 entries keep 200 lines and add a truncated note", () => {
  const toc = Array.from({ length: 201 }, (_, index) => ({
    index,
    label: `Chapter ${index}`,
    href: `ch${index}.xhtml`,
  }));
  const text = formatBookSnapshot(meta, toc);
  assert.match(text, /Table of Contents \(200 of 201 entries\):/);
  assert.match(text, /0: Chapter 0/);
  assert.match(text, /199: Chapter 199/);
  assert.equal(text.includes("200: Chapter 200"), false);
  assert.match(text, /\[TOC truncated\. Call get_toc for the full list\.\]/);
  const bodyLines = text
    .split("Table of Contents (200 of 201 entries):\n")[1]
    .split("\n")
    .filter((line) => /^\d+: /.test(line));
  assert.equal(bodyLines.length, BOOK_SNAPSHOT_MAX_TOC_ENTRIES);
});

test("long labels hit the 4000-char cap with fewer than 200 lines", () => {
  const label = "A".repeat(2000);
  const toc = [0, 1, 2].map((index) => ({
    index,
    label,
    href: `ch${index}.xhtml`,
  }));
  const text = formatBookSnapshot(meta, toc);
  assert.match(text, /Table of Contents \(1 of 3 entries\):/);
  assert.match(text, new RegExp(`0: ${label}`));
  assert.equal(text.includes(`1: ${label}`), false);
  assert.match(text, /\[TOC truncated\. Call get_toc for the full list\.\]/);
  const body = text.split("Table of Contents (1 of 3 entries):\n")[1].split("\n")[0];
  assert.equal(body.length <= BOOK_SNAPSHOT_MAX_TOC_CHARS, true);
  assert.equal(text.includes("ch0.xhtml"), false);
  assert.equal(text.includes("ch1.xhtml"), false);
});

test("empty TOC includes metadata and 0 of 0 with no truncated note", () => {
  const text = formatBookSnapshot({ ...meta, totalChapters: 0 }, []);
  assert.match(text, /Title: Moby-Dick/);
  assert.match(text, /Author: Herman Melville/);
  assert.match(text, /Language: en/);
  assert.match(text, /Total chapters: 0/);
  assert.match(text, /Table of Contents \(0 of 0 entries\):/);
  assert.equal(text.includes("[TOC truncated."), false);
});

test("sessionHasBookSnapshot is false for empty or readingContext-only messages", () => {
  assert.equal(sessionHasBookSnapshot([]), false);
  assert.equal(
    sessionHasBookSnapshot([
      { role: "custom", customType: "readingContext", content: "（当前在第 1 章）" },
      { role: "user", content: "hello" },
    ]),
    false,
  );
});

test("sessionHasBookSnapshot is true when a bookSnapshot custom message is present", () => {
  assert.equal(
    sessionHasBookSnapshot([
      { role: "custom", customType: "readingContext", content: "note" },
      { role: "custom", customType: BOOK_SNAPSHOT_CUSTOM_TYPE, content: "snapshot" },
    ]),
    true,
  );
});
