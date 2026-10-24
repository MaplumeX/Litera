import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { CHAPTER_PART_CHARS } from "./book-content";
import { bookToc, buildOwnedChapters, chapterWindows, hrefFragment, locateQuote, markdownText, parseEpub, parseSpineSegments, readChapter, readImageFile, searchBook, stripFragment, type NavNode, type ParsedBook } from "./epub-content";

type FileMap = Record<string, string>;

function pack(files: FileMap): ArrayBuffer {
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])),
  );
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

function opf(items: string, spine: string): string {
  return `
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Fixture</dc:title><dc:creator>Author</dc:creator><dc:language>zh</dc:language></metadata>
        <manifest>${items}</manifest>
        <spine>${spine}</spine>
      </package>`;
}

const CONTAINER = '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>';

function baseFiles(items: string, spine: string, extra: FileMap): FileMap {
  return {
    "META-INF/container.xml": CONTAINER,
    "OPS/book.opf": opf(items, spine),
    ...Object.fromEntries(Object.entries(extra).map(([path, text]) => [`OPS/${path}`, text])),
  };
}

function epub(options: { nav?: boolean; ncx?: boolean } = { nav: true }): ArrayBuffer {
  const navItem = options.nav
    ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    : "";
  const ncxItem = options.ncx
    ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    : "";
  const files = baseFiles(
    `${navItem}${ncxItem}
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
          <item id="three" href="text/three.xhtml" media-type="application/xhtml+xml"/>`,
    '<itemref idref="one"/><itemref idref="two"/><itemref idref="three"/>',
    {
      "nav.xhtml": options.nav
        ? '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a href="cover.xhtml">Cover</a></nav><nav epub:type="toc"><a href="text/one.xhtml">Opening</a><a href="text/three.xhtml">Ending</a></nav></body></html>'
        : "",
      "toc.ncx": options.ncx
        ? '<ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="text/one.xhtml"/></navPoint><navPoint><navLabel><text>Ending</text></navLabel><content src="text/three.xhtml"/></navPoint></navMap></ncx>'
        : "",
      "text/one.xhtml": "<html><body>alpha exact phrase</body></html>",
      "text/two.xhtml": "<html><body>middle split chapter text</body></html>",
      "text/three.xhtml": "<html><body>omega second token</body></html>",
    },
  );
  return pack(files);
}

const singleSpineItems =
  '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\
    <item id="vol1" href="text/vol1.xhtml" media-type="application/xhtml+xml"/>';

function hierarchyFiles(navBody: string, files: FileMap): FileMap {
  return {
    ...baseFiles(
      singleSpineItems,
      '<itemref idref="vol1"/>',
      {},
    ),
    "OPS/nav.xhtml": `<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc">${navBody}</nav></body></html>`,
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`OPS/${path}`, text])),
  };
}

const volumeOneSource =
  '<html><body><p id="ch1">第一章 火车站 content ch1</p><p id="ch2">第二章 母亲的信 content ch2</p><p id="ch3">第三章 content ch3</p></body></html>';

const ac1Files = (): FileMap =>
  hierarchyFiles(
    `<ol><li><a href="text/vol1.xhtml#ch1">第一卷 出走</a><ol><li><a href="text/vol1.xhtml#ch1">第一章 火车站</a></li><li><a href="text/vol1.xhtml#ch2">第二章 母亲的信</a></li><li><a href="text/vol1.xhtml#ch3">第三章</a></li></ol></li></ol>`,
    { "text/vol1.xhtml": volumeOneSource },
  );

// Rich structural fixture for the read_chapter Markdown projection (AC1/AC5).
const richChapterSource = `<html><body><h1 id="ch1">Chapter One</h1><p>The <em>quick</em> brown fox runs into the <strong>strong</strong> city.</p><h2>Later</h2><blockquote><p>A quoted line.</p></blockquote><ul><li>first item</li><li>second item</li></ul><ol><li>ordered</li></ol><pre>code line
keep  spacing</pre></body></html>`;

const richMarkdown = [
  "# Chapter One",
  "The *quick* brown fox runs into the **strong** city.",
  "## Later",
  "> A quoted line.",
  "- first item\n- second item",
  "1. ordered",
  "code line\nkeep  spacing",
].join("\n\n");

const richFiles = (): FileMap =>
  hierarchyFiles(flatNav(["Rich chapter"], ["text/vol1.xhtml#ch1"]), {
    "text/vol1.xhtml": richChapterSource,
  });

// Long fixture exercising paragraph-aligned window packing (AC5): one small
// anchor paragraph plus ten 5k paragraphs, so windows hold two blocks each.
const longChapterSource = (): string => {
  const paragraphs = ["start", ...Array.from({ length: 10 }, () => "a".repeat(5000))];
  return `<html><body>${paragraphs
    .map((text, index) => `<p${index === 0 ? ' id="ch1"' : ""}>${text}</p>`)
    .join("")}</body></html>`;
};

const longFiles = (): FileMap =>
  hierarchyFiles(flatNav(["Long chapter"], ["text/vol1.xhtml#ch1"]), {
    "text/vol1.xhtml": longChapterSource(),
  });

const flatNav = (labels: string[], hrefs: string[]): string =>
  labels.map((label, index) => `<a href="${hrefs[index]}">${label}</a>`).join("");

describe("url helpers", () => {
  it("keeps fragments in resolved TOC hrefs and strips them for file resolution", () => {
    expect(stripFragment("OPS/text/vol1.xhtml#ch2")).toBe("OPS/text/vol1.xhtml");
    expect(hrefFragment("OPS/text/vol1.xhtml#ch2")).toBe("ch2");
    expect(hrefFragment("OPS/text/vol1.xhtml")).toBe("");
    const files = hierarchyFiles(flatNav(["一", "二"], ["text/vol1.xhtml#a", "text/vol1.xhtml#b"]), {
      "text/vol1.xhtml": "<html><body><p id=\"a\">A</p><p id=\"b\">B</p></body></html>",
    });
    const book = parseEpub(pack(files));
    expect(bookToc(book).map((entry) => entry.label)).toEqual(["一", "二"]);
  });
});

describe("parseSpineSegments", () => {
  it("returns a single leading segment without anchors", () => {
    expect(parseSpineSegments("<html><body>plain text</body></html>")).toEqual([
      { text: "plain text", markdown: "plain text" },
    ]);
  });

  it("keeps a GFM table in the markdown projection", () => {
    const source = "<html><body><p>前</p><table><tr><th>年份</th><th>人口</th></tr><tr><td>1990</td><td>a|b</td></tr></table></body></html>";
    expect(parseSpineSegments(source)).toEqual([
      { text: "前年份人口1990a|b", markdown: "前\n\n| 年份 | 人口 |\n| --- | --- |\n| 1990 | a\\|b |" },
    ]);
  });

  it("slices at anchor elements first/middle/last", () => {
    const source =
      '<html><body>intro <h1 id="a">One</h1>first <h2 id="b">Two</h2>second tail</body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "intro", markdown: "intro" },
      { anchorId: "a", text: "Onefirst", markdown: "# One\n\nfirst" },
      { anchorId: "b", text: "Twosecond tail", markdown: "## Two\n\nsecond tail" },
    ]);
  });

  it("supports EPUB2 <a name> anchors", () => {
    const source = '<html><body><a name="start"></a>opened body</body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "", markdown: "" },
      { anchorId: "start", text: "opened body", markdown: "opened body" },
    ]);
  });

  it("treats inline-span anchors as segment boundaries", () => {
    const source = '<html><body><p>alpha <span id="mid">beta</span> gamma</p></body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "alpha", markdown: "alpha" },
      { anchorId: "mid", text: "beta gamma", markdown: "beta gamma" },
    ]);
  });

  it("keeps anchor slices aligned when anchors sit inside div containers (production shape)", () => {
    const source = '<html><body><div><h2 id="s1">One</h2>a <p id="s2">Two</p>b</div></body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "", markdown: "" },
      { anchorId: "s1", text: "Onea", markdown: "## One\n\na" },
      { anchorId: "s2", text: "Twob", markdown: "Two\n\nb" },
    ]);
  });

  it("falls back to a single htmlText segment on malformed markup", () => {
    const source = "<html><body><p>unclosed <div>text";
    const segments = parseSpineSegments(source);
    expect(segments).toHaveLength(1);
    expect(segments[0].anchorId).toBeUndefined();
    expect(segments[0].text).toContain("unclosed");
  });

  it("keeps structure for div/section-wrapped chapter bodies (production shape)", () => {
    const body = (wrapper: "div" | "section"): string =>
      `<${wrapper} class="ch"><h2 id="ch1">T</h2><p>one</p><p>two <em>x</em></p><blockquote><p>q1</p><p>q2</p></blockquote><pre>code\n  indented</pre></${wrapper}>`;
    const expectedMarkdown = [
      "## T",
      "one",
      "two *x*",
      "> q1\n>\n> q2",
      "code\n  indented",
    ].join("\n\n");
    for (const wrapper of ["div", "section"] as const) {
      const segments = parseSpineSegments(`<html><body>${body(wrapper)}</body></html>`);
      expect(segments[segments.length - 1]).toEqual({
        anchorId: "ch1",
        text: "Tonetwo xq1q2code indented",
        markdown: expectedMarkdown,
      });
      expect(segments.slice(0, -1)).toEqual([{ text: "", markdown: "" }]);
    }
  });
});

function navDoc(entries: string): string {
  return `<nav xmlns:epub="http://www.idpf.org/2007/ops" epub:type="toc">${entries}</nav>`;
}

describe("TOC depth extraction", () => {
  it("computes depth from nested nav <ol> elements", () => {
    const files = hierarchyFiles(
      `<ol><li><a href="text/vol1.xhtml#ch1">第一卷 出走</a><ol><li><a href="text/vol1.xhtml#ch1">第一章</a></li><li><a href="text/vol1.xhtml#ch2">第二章</a></li></ol></li></ol>`,
      { "text/vol1.xhtml": '<html><body><p id="ch1">一</p><p id="ch2">二</p></body></html>' },
    );
    const book = parseEpub(pack(files));
    // The 第一卷 container shares its first child's target and collapses (design "Container entries").
    expect(bookToc(book).map((entry) => [entry.label, entry.depth, entry.ancestors])).toEqual([
      ["第一章", 1, ["第一卷 出走"]],
      ["第二章", 1, ["第一卷 出走"]],
    ]);
  });

  it("computes depth from nested ncx navPoints", () => {
    const files = {
      "META-INF/container.xml": CONTAINER,
      "OPS/book.opf": opf(
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>\
          <item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>',
        '<itemref idref="a"/>',
      ),
      "OPS/toc.ncx":
        '<ncx><navMap><navPoint><navLabel><text>Volume</text></navLabel><content src="a.xhtml#s1"/><navPoint><navLabel><text>Part</text></navLabel><content src="a.xhtml#s1"/></navPoint></navPoint></navMap></ncx>',
      "OPS/a.xhtml": '<html><body><p id="s1">body text</p></body></html>',
    };
    const book = parseEpub(pack(files));
    const toc = bookToc(book);
    expect(toc).toHaveLength(1);
    expect(toc[0].label).toBe("Part");
    expect(toc[0].ancestors).toEqual(["Volume"]);
    expect(toc[0].depth).toBe(1);
  });
});

describe("anchor-level ownership (AC1–AC3)", () => {

  it("AC1: splits one spine file into three anchor chapters under the volume", () => {
    const book = parseEpub(pack(ac1Files()));
    const toc = bookToc(book);
    expect(toc.map((entry) => entry.label)).toEqual(["第一章 火车站", "第二章 母亲的信", "第三章"]);
    toc.forEach((entry) => {
      expect(entry.ancestors).toEqual(["第一卷 出走"]);
      expect(entry.depth).toBe(1);
    });
    expect(readChapter(book, 1).text).toBe("第二章 母亲的信 content ch2");
    expect(readChapter(book, 1).chapterTitle).toBe("第一卷 出走 › 第二章 母亲的信");
    expect(toc[1].chars).toBe(readChapter(book, 1).text.length);
  });

  it("AC2: a per-file volume keeps file-level ownership and hierarchy rendering", () => {
    const files = {
      ...hierarchyFiles(
        `<ol><li><a href="text/vol1.xhtml#ch1">第一卷 出走</a><ol><li><a href="text/vol1.xhtml#ch1">第一章</a></li></ol></li><li><a href="text/vol2.xhtml">第二卷</a><ol><li><a href="text/vol2.xhtml">第四章</a></li></ol></li></ol>`,
        { "text/vol1.xhtml": volumeOneSource },
      ),
      "OPS/text/vol2.xhtml": "<html><body>第四章 content vol2</body></html>",
      "OPS/book.opf": hierarchyFiles("", {})["OPS/book.opf"]
        .replace(
          "</manifest>",
          '<item id="vol2" href="text/vol2.xhtml" media-type="application/xhtml+xml"/></manifest>',
        )
        .replace("</spine>", '<itemref idref="vol2"/></spine>'),
    };
    const book = parseEpub(pack(files));
    const toc = bookToc(book);
    expect(toc.map((entry) => [entry.label, entry.hrefs])).toEqual([
      ["第一章", ["OPS/text/vol1.xhtml", "OPS/text/vol1.xhtml#ch1", "OPS/text/vol1.xhtml#ch2", "OPS/text/vol1.xhtml#ch3"]],
      ["第四章", ["OPS/text/vol2.xhtml"]],
    ]);
    expect(toc[0].ancestors).toEqual(["第一卷 出走"]);
    expect(toc[1].ancestors).toEqual(["第二卷"]);
  });

  it("AC3: missing fragment id falls back to the previous claimer without losing text", () => {
    const files = hierarchyFiles(
      flatNav(["S1", "S2", "Broken"], ["text/vol1.xhtml#sec1", "text/vol1.xhtml#sec2", "text/vol1.xhtml#secX"]),
      { "text/vol1.xhtml": '<html><body><p id="sec1">first</p><p id="sec2">second</p></body></html>' },
    );
    const book = parseEpub(pack(files));
    const toc = bookToc(book);
    expect(toc.map((entry) => entry.label)).toEqual(["S1", "S2"]);
    expect(readChapter(book, 0).text).toBe("first");
    expect(readChapter(book, 1).text).toBe("second");
    expect(readChapter(book, 0).text + readChapter(book, 1).text).toBe("firstsecond");
  });

  it("AC3 variant: duplicate fragment ids stay with the first claimer", () => {
    const files = hierarchyFiles(
      flatNav(["D1", "D2"], ["text/vol1.xhtml#dup", "text/vol1.xhtml#dup"]),
      { "text/vol1.xhtml": '<html><body><p id="dup">shared text</p></body></html>' },
    );
    const book = parseEpub(pack(files));
    const toc = bookToc(book);
    expect(toc.map((entry) => entry.label)).toEqual(["D1"]);
    expect(readChapter(book, 0).text).toBe("shared text");
  });

  it("AC3 variant: a leading unresolvable fragment claims the file and later fragments still split", () => {
    const files = hierarchyFiles(
      flatNav(["Lead", "B"], ["text/vol1.xhtml#missing", "text/vol1.xhtml#b"]),
      { "text/vol1.xhtml": '<html><body>intro <p id="b">tail</p></body></html>' },
    );
    const book = parseEpub(pack(files));
    expect(bookToc(book).map((entry) => [entry.label, entry.hrefs])).toEqual([
      ["Lead", ["OPS/text/vol1.xhtml"]],
      ["B", ["OPS/text/vol1.xhtml#b"]],
    ]);
    expect(readChapter(book, 0).text).toBe("intro");
    expect(readChapter(book, 1).text).toBe("tail");
  });

  it("unclaimed slices join the preceding claimer (first claimer for leading text)", () => {
    const files = hierarchyFiles(
      flatNav(["B"], ["text/vol1.xhtml#b"]),
      {
        "text/vol1.xhtml":
          '<html><body>intro <p id="a">orphan</p><p id="b">owned</p><p id="c">trailing</p></body></html>',
      },
    );
    const book = parseEpub(pack(files));
    expect(bookToc(book)).toHaveLength(1);
    // Multi-segment chapter markdown joins slices with `\n\n` so structure
    // markers stay on their own lines (segment-level dense guard plus the
    // `\n\n` joints only add strippable whitespace).
    expect(readChapter(book, 0).text).toBe("intro\n\norphan\n\nowned\n\ntrailing");
    expect(bookToc(book)[0].hrefs).toEqual([
      "OPS/text/vol1.xhtml",
      "OPS/text/vol1.xhtml#a",
      "OPS/text/vol1.xhtml#b",
      "OPS/text/vol1.xhtml#c",
    ]);
  });
});

describe("AC4 fallbacks and invariants", () => {
  it("empty TOC falls back to one chapter per spine file", () => {
    const fallback = parseEpub(epub({}));
    expect(fallback.chapters).toHaveLength(3);
    expect(fallback.chapters.every((chapter) => chapter.label === "" && chapter.depth === 0)).toBe(true);
  });

  it("unresolvable TOC entries never drop spine text (union invariant)", () => {
    const files = {
      ...hierarchyFiles(
        flatNav(["X", "Y"], ["text/vol1.xhtml#gone", "text/vol2.xhtml#gone"]),
        { "text/vol1.xhtml": '<html><body><p id="a">one</p></body></html>' },
      ),
      "OPS/text/vol2.xhtml": '<html><body><p id="b">two</p></body></html>',
      "OPS/book.opf": hierarchyFiles("", {})["OPS/book.opf"]
        .replace(
          "</manifest>",
          '<item id="vol2" href="text/vol2.xhtml" media-type="application/xhtml+xml"/></manifest>',
        )
        .replace("</spine>", '<itemref idref="vol2"/></spine>'),
    };
    const book = parseEpub(pack(files));
    expect(readChapter(book, 0).text + readChapter(book, 1).text).toBe("onetwo");
  });

  it("keeps the union-of-texts invariant on every fixture", () => {
    const fixtures: Array<{ buffer: ArrayBuffer; spine: string[] }> = [
      { buffer: pack(ac1Files()), spine: ["OPS/text/vol1.xhtml"] },
      { buffer: pack(richFiles()), spine: ["OPS/text/vol1.xhtml"] },
      { buffer: pack(longFiles()), spine: ["OPS/text/vol1.xhtml"] },
      { buffer: epub({ nav: true }), spine: ["OPS/text/one.xhtml", "OPS/text/two.xhtml", "OPS/text/three.xhtml"] },
      { buffer: epub({ ncx: true }), spine: ["OPS/text/one.xhtml", "OPS/text/two.xhtml", "OPS/text/three.xhtml"] },
      { buffer: epub({}), spine: ["OPS/text/one.xhtml", "OPS/text/two.xhtml", "OPS/text/three.xhtml"] },
      {
        buffer: pack(hierarchyFiles(
          flatNav(["S1", "S2", "Broken"], ["text/vol1.xhtml#sec1", "text/vol1.xhtml#sec2", "text/vol1.xhtml#secX"]),
          { "text/vol1.xhtml": '<html><body><p id="sec1">first</p><p id="sec2">second</p></body></html>' },
        )),
        spine: ["OPS/text/vol1.xhtml"],
      },
      {
        buffer: pack(hierarchyFiles(
          flatNav(["Lead", "B"], ["text/vol1.xhtml#missing", "text/vol1.xhtml#b"]),
          { "text/vol1.xhtml": '<html><body>intro <p id="b">tail</p></body></html>' },
        )),
        spine: ["OPS/text/vol1.xhtml"],
      },
    ];
    // Independent spine-text extraction (a copy of the legacy htmlText
    // projection) so ownership v2 is checked against the raw files.
    const parser = new DOMParser();
    const fileText = (buffer: ArrayBuffer, href: string): string => {
      const bytes = unzipSync(new Uint8Array(buffer))[href];
      const raw = bytes ? strFromU8(bytes) : "";
      return parser.parseFromString(raw, "text/html").documentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    };
    const sorted = (text: string): string => [...text.replace(/\s+/g, "")].sort().join("");
    // Whitespace may differ at segment boundaries (each slice trims its own
    // edges); the invariant is that no characters of content are lost.
    const dense = (text: string): number => text.replace(/\s+/g, "").length;
    // Mirror of the source's internal denseMarkdown: strip Markdown structural
    // markers (heading/quote/list line prefixes, emphasis delimiters), then
    // drop all whitespace — comparable against dense flat text. A chapter whose
    // markdown would not dense-equal its flat text fell back to flat text, so
    // this assertion holds on every chapter.
    const denseMarkdown = (markdown: string): string => {
      const lines = markdown.split("\n").map((line) => {
        let text = line.replace(/^(\s*)([-+]|\d{1,9}\.)\s+/, "$1");
        text = text.replace(/^(\s*)#{1,6}\s+/, "$1");
        while (/^(\s*)>\s?/.test(text)) text = text.replace(/^(\s*)>\s?/, "$1");
        return text;
      });
      return lines
        .join("\n")
        .split("**")
        .join("")
        .split("~~")
        .join("")
        .split("*")
        .join("")
        .replace(/\s+/g, "");
    };
    for (const { buffer, spine } of fixtures) {
      const book = parseEpub(buffer);
      const chapterText = book.chapters.map((chapter) => chapter.text).join("");
      const spineText = spine.map((href) => fileText(buffer, href)).join("");
      expect(sorted(chapterText)).toBe(sorted(spineText));
      expect(dense(chapterText)).toBe(dense(spineText));
      book.chapters.forEach((chapter) => {
        expect(denseMarkdown(chapter.markdown)).toBe(chapter.text.replace(/\s+/g, ""));
      });
    }
  });

  it("no-fragment nodes keep whole-file ownership to the first claimer", () => {
    const files = hierarchyFiles(
      flatNav(["A", "B"], ["text/vol1.xhtml", "text/vol1.xhtml"]),
      { "text/vol1.xhtml": "<html><body>whole file body</body></html>" },
    );
    const book = parseEpub(pack(files));
    expect(bookToc(book).map((entry) => entry.label)).toEqual(["A"]);
    expect(readChapter(book, 0).text).toBe("whole file body");
  });
});

describe("browser EPUB projection", () => {
  it("uses EPUB 3 TOC ownership and merges split spine content", () => {
    const book = parseEpub(epub({ nav: true }));
    expect(book.metadata).toEqual({ title: "Fixture", author: "Author", language: "zh", totalChapters: 2 });
    expect(bookToc(book)).toMatchObject([
      { index: 0, label: "Opening", depth: 0, ancestors: [], hrefs: ["OPS/text/one.xhtml", "OPS/text/two.xhtml"] },
      { index: 1, label: "Ending", depth: 0, ancestors: [], hrefs: ["OPS/text/three.xhtml"] },
    ]);
    expect(readChapter(book, 0).text).toContain("middle split chapter text");
  });

  it("supports EPUB 2 NCX and empty-TOC spine fallback", () => {
    expect(parseEpub(epub({ ncx: true })).chapters.map((chapter) => chapter.label)).toEqual([
      "Opening",
      "Ending",
    ]);
    const fallback = parseEpub(epub({}));
    expect(fallback.chapters).toHaveLength(3);
    expect(fallback.chapters.every((chapter) => chapter.label === "")).toBe(true);
  });

  it("search reports the fine-grained chapterIndex and hierarchical title path", () => {
    const files = hierarchyFiles(
      `<ol><li><a href="text/vol1.xhtml#ch1">第一卷</a><ol><li><a href="text/vol1.xhtml#ch1">一</a></li><li><a href="text/vol1.xhtml#ch2">二</a></li></ol></li></ol>`,
      {
        "text/vol1.xhtml":
          '<html><body><p id="ch1">alpha exact phrase</p><p id="ch2">omega second token</p></body></html>',
      },
    );
    const book = parseEpub(pack(files));
    const hits = searchBook(book, ["exact phrase", "omega second missing absent"]);
    expect(hits.map((hit) => [hit.chapterIndex, hit.chapterTitle, hit.match])).toEqual([
      [0, "第一卷 › 一", "exact"],
      [1, "第一卷 › 二", "partial"],
    ]);
    const flat = parseEpub(epub({ nav: true }));
    expect(searchBook(flat, ["exact phrase"])[0].chapterTitle).toBe("Opening");
  });

  it("reports the read_chapter part that holds each hit", () => {
    // Links make the Markdown longer than the plain text, and the parts are
    // cut at sections, so a hit's part cannot come from its plain-text offset.
    const link = '<a href="https://example.com/a/very/long/link/target/that/only/the/markdown/carries">see</a>';
    const paragraphs = Array.from({ length: 40 }, (_, index) =>
      `${index % 10 === 0 ? `<h2>Section ${index / 10}</h2>` : ""}<p>marker${index}x ${"word ".repeat(80)}${link}</p>`).join("");
    const files = hierarchyFiles('<ol><li><a href="text/vol1.xhtml">One</a></li></ol>', {
      "text/vol1.xhtml": `<html><body>${paragraphs}</body></html>`,
    });
    const book = parseEpub(pack(files));
    expect(readChapter(book, 0).totalParts).toBeGreaterThan(1);
    for (let index = 0; index < 40; index += 1) {
      const [hit] = searchBook(book, [`marker${index}x`]);
      expect(readChapter(book, 0, hit.part).text, `marker${index}x`).toContain(`marker${index}x`);
    }
  });

  it("deduplicates multi-query hits and supports deterministic partial matching", () => {
    const book = parseEpub(epub({ nav: true }));
    expect(book.trigramIndex.get("ome")).toEqual([1]);
    const hits = searchBook(book, ["exact phrase", "exact phrase", "omega second missing absent"]);
    expect(hits.map((hit) => [hit.chapterIndex, hit.match])).toEqual([
      [0, "exact"],
      [1, "partial"],
    ]);
  });
});

describe("markdownText", () => {
  it("maps headings to Markdown levels", () => {
    expect(markdownText("<html><body><h1>A</h1><h2>B</h2><h3>C</h3><h6>F</h6></body></html>")).toBe("# A\n\n## B\n\n### C\n\n###### F");
  });

  it("renders paragraphs with collapsed inline whitespace and inline emphasis", () => {
    const source = '<html><body><p>Hello   <em>world</em> <strong>soon</strong> <b>now</b> <del>gone</del></p></body></html>';
    expect(markdownText(source)).toBe("Hello *world* **soon** **now** ~~gone~~");
  });

  it("prefixes blockquote lines with > and joins quoted paragraphs", () => {
    expect(markdownText("<blockquote><p>q1</p><p>q2</p></blockquote>")).toBe(
      "> q1\n>\n> q2",
    );
  });

  it("renders lists with nesting and ordered numbering", () => {
    const source = '<html><body><ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul><ol><li>one</li></ol></body></html>';
    expect(markdownText(source)).toBe("- a\n- b\n  - b1\n\n1. one");
  });

  it("keeps pre content verbatim with line breaks and no collapsing", () => {
    const source = '<html><body><pre>line1\nline2  spaced</pre></body></html>';
    expect(markdownText(source)).toBe("line1\nline2  spaced");
  });

  it("renders audio/video and image-free svg as empty and keeps br as an in-paragraph break", () => {
    expect(markdownText('<html><body><p>a<audio src="x.mp3"/><video src="x.mp4"/><svg><rect/></svg><br/>b</p></body></html>')).toBe("a\nb");
  });

  it("renders img and svg <image> as Markdown image placeholders", () => {
    expect(markdownText('<html><body><p>see<img src="x.png" alt="Fig [1]  map"/>here</p></body></html>')).toBe("see![Fig 1 map](x.png)here");
    expect(markdownText('<html xmlns:xlink="http://www.w3.org/1999/xlink"><body><div><svg><image xlink:href="cover.jpg"/></svg></div></body></html>')).toBe("![](cover.jpg)");
    expect(markdownText('<html><body><p><img src="my pic (1).png" title="T"/></p></body></html>')).toBe("![T](my%20pic%20%281%29.png)");
  });

  it("drops images that are not packaged in the book", () => {
    expect(markdownText('<html><body><p>a<img src="data:image/png;base64,AA"/><img src="https://x.test/a.png"/>b</p></body></html>')).toBe("ab");
  });

  it("keeps nested block structure inside div/section wrappers (production shape)", () => {
    const inner = '<h2>T</h2><p>one</p><p>two <em>x</em></p><blockquote><p>q1</p><p>q2</p></blockquote><pre>code\n  indented</pre>';
    const expected = [
      "## T",
      "one",
      "two *x*",
      "> q1\n>\n> q2",
      "code\n  indented",
    ].join("\n\n");
    expect(markdownText(`<html><body><div class="ch">${inner}</div></body></html>`)).toBe(expected);
    expect(markdownText(`<html><body><section class="ch">${inner}</section></body></html>`)).toBe(expected);
  });

  it("keeps blockquotes and mixed inline/block content intact through wrappers", () => {
    expect(markdownText("<html><body><div><blockquote><p>q1</p><p>q2</p></blockquote></div></body></html>")).toBe("> q1\n>\n> q2");
    expect(markdownText("<html><body><blockquote><div><p>q1</p><p>q2</p></div></blockquote></body></html>")).toBe("> q1\n>\n> q2");
    expect(markdownText('<html><body><div>lead <p>para</p> tail</div></body></html>')).toBe("lead\n\npara\n\ntail");
  });

  it("keeps unknown elements transparent and single-column tables as plain block text", () => {
    expect(markdownText('<html><body><article><p>kept</p></article><table><tr><td>cell</td></tr></table></body></html>')).toBe("kept\n\ncell");
    expect(markdownText("<html><body><table><tr><td><p>a</p></td></tr><tr><td>b|c</td></tr></table></body></html>")).toBe("a\n\nb|c");
  });

  it("renders multi-column tables as GFM tables with their caption", () => {
    const html = `<html><body><table><caption>人口</caption><thead><tr><th>年份</th><th>人口</th></tr></thead>
      <tbody><tr><td>1990</td><td><p>11</p><p>亿</p></td></tr><tr><td colspan="2">a|b</td></tr></tbody></table></body></html>`;
    expect(markdownText(html)).toBe("人口\n\n| 年份 | 人口 |\n| --- | --- |\n| 1990 | 11 亿 |\n| a\\|b |  |");
  });

  it("returns empty for unparsable roots", () => {
    expect(markdownText("<html><body></body></html>")).toBe("");
  });
});

describe("chapterWindows", () => {
  it("packs paragraph blocks into <=12k windows of about equal size and rejoins exactly", () => {
    const paragraphs = ["a".repeat(6000), "b".repeat(5000), "c".repeat(2000)];
    const markdown = paragraphs.join("\n\n");
    const windows = chapterWindows(markdown);
    expect(windows).toEqual([paragraphs[0], `${paragraphs[1]}\n\n${paragraphs[2]}`]);
    windows.forEach((window) => expect(window.length).toBeLessThanOrEqual(12_000));
    expect(windows.join("\n\n")).toBe(markdown);
  });

  it("cuts just before a section heading rather than mid-section", () => {
    const paragraph = (char: string) => char.repeat(1_000);
    const first = Array.from({ length: 7 }, () => paragraph("a"));
    const second = ["## Second", ...Array.from({ length: 8 }, () => paragraph("b"))];
    const markdown = [...first, ...second].join("\n\n");
    const windows = chapterWindows(markdown);
    expect(windows).toHaveLength(2);
    expect(windows[1].startsWith("## Second")).toBe(true);
    expect(windows.join("\n\n")).toBe(markdown);
  });

  it("never leaves a heading at the end of a part", () => {
    const blocks = ["a".repeat(5_990), "### Next", "b".repeat(6_000), "c".repeat(5_000)];
    const markdown = blocks.join("\n\n");
    const windows = chapterWindows(markdown);
    windows.forEach((window) => expect(window.split("\n\n").pop()?.startsWith("#")).toBe(false));
    expect(windows.join("\n\n")).toBe(markdown);
  });

  it("cuts at a scene break when there are no headings", () => {
    const markdown = ["a".repeat(4_000), "a".repeat(4_000), "* * *", "b".repeat(4_000), "b".repeat(4_000)].join("\n\n");
    expect(chapterWindows(markdown)[1].startsWith("* * *")).toBe(true);
  });

  it("adds one part when that lets every cut fall on a section boundary", () => {
    // Greedy packing needs only two parts, but either two-part cut is mid-section.
    const section = (title: string, char: string) => [`## ${title}`, ...Array.from({ length: 7 }, () => char.repeat(1_000))];
    const markdown = [...section("One", "a"), ...section("Two", "b"), ...section("Three", "c")].join("\n\n");
    expect(markdown.length).toBeLessThan(24_000);
    const windows = chapterWindows(markdown);
    expect(windows).toHaveLength(3);
    expect(windows.map((window) => window.slice(0, 6))).toEqual(["## One", "## Two", "## Thr"]);
  });

  it("does not add a part when the greedy count already cuts on sections", () => {
    const section = (title: string, char: string) => [`## ${title}`, ...Array.from({ length: 10 }, () => char.repeat(1_000))];
    const markdown = [...section("One", "a"), ...section("Two", "b")].join("\n\n");
    expect(chapterWindows(markdown)).toHaveLength(2);
  });

  it("packs a single block that exactly fits the limit into one window", () => {
    const markdown = "x".repeat(12_000);
    expect(chapterWindows(markdown)).toEqual([markdown]);
  });

  it("hard-splits an oversized single block into 12k windows", () => {
    const markdown = "x".repeat(12_001);
    const windows = chapterWindows(markdown);
    expect(windows.map((window) => window.length)).toEqual([12_000, 1]);
    // Hard-split pieces are exact consecutive slices of the oversized block.
    expect(windows.join("")).toBe(markdown);
  });

  it("packs the hard-split residual with following blocks instead of wasting a near-empty window", () => {
    const oversized = "a".repeat(13_000);
    const tiny = "b".repeat(100);
    const windows = chapterWindows(`${oversized}\n\n${tiny}`);
    expect(windows).toEqual(["a".repeat(12_000), `${"a".repeat(1_000)}\n\n${tiny}`]);
    expect(windows[0] + windows[1]).toBe(`${oversized}\n\n${tiny}`);
  });

  it("seals a trailing hard-split residual as its own window", () => {
    const windows = chapterWindows(`lead\n\n${"x".repeat(15_000)}`);
    expect(windows).toEqual(["lead", "x".repeat(12_000), "x".repeat(3_000)]);
  });

  it("returns one empty window for empty markdown", () => {
    expect(chapterWindows("")).toEqual([""]);
  });
});

describe("read_chapter structured Markdown (AC1/AC5)", () => {
  it("AC1: read_chapter returns headings, emphasis, quotes, lists, and verbatim pre", () => {
    const book = parseEpub(pack(richFiles()));
    const result = readChapter(book, 0);
    expect(result.text).toBe(richMarkdown);
    expect(result.text).toContain("\n\n");
    expect(result.text).toContain("# Chapter One");
    expect(result.text).toContain("## Later");
    expect(result.text).toContain("*quick*");
    expect(result.text).toContain("**strong**");
    expect(result.text).toContain("> A quoted line.");
    expect(result.text).toContain("- first item\n- second item");
    expect(result.text).toContain("1. ordered");
    expect(result.text).toContain("code line\nkeep  spacing");
  });

  it("AC5: a small chapter fits one window, chars matches markdown length, and part clamps", () => {
    const book = parseEpub(pack(richFiles()));
    const chapter = book.chapters[0];
    const windows = chapterWindows(chapter.markdown);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toBe(chapter.markdown);
    expect(bookToc(book)[0].chars).toBe(chapter.markdown.length);
    expect(readChapter(book, 0)).toMatchObject({ part: 0, totalParts: 1 });
    expect(readChapter(book, 0, 99)).toMatchObject({ part: 0, totalParts: 1 });
    expect(readChapter(book, 0, -5).part).toBe(0);
  });

  it("AC5: totalParts follows paragraph packing and windows rejoin the chapter markdown", () => {
    const book = parseEpub(pack(longFiles()));
    const chapter = book.chapters[0];
    const windows = chapterWindows(chapter.markdown);
    expect(windows.length).toBeGreaterThan(1);
    const result = readChapter(book, 0, 0);
    expect(result.totalParts).toBe(windows.length);
    const parts = Array.from({ length: result.totalParts }, (_, part) => readChapter(book, 0, part).text);
    expect(parts).toEqual(windows);
    parts.forEach((part) => expect(part.length).toBeLessThanOrEqual(12_000));
    expect(parts.join("\n\n")).toBe(chapter.markdown);
    expect(readChapter(book, 0, 99).part).toBe(result.totalParts - 1);
    expect(bookToc(book)[0].chars).toBe(chapter.markdown.length);
  });

  it("AC1: keeps structure in div/section-wrapped chapter bodies through the full pipeline", () => {
    const body = (wrapper: "div" | "section"): string =>
      `<${wrapper} class="ch"><h2 id="ch1">T</h2><p>one</p><p>two <em>x</em></p><blockquote><p>q1</p><p>q2</p></blockquote><pre>code\n  indented</pre></${wrapper}>`;
    const expected = "## T\n\none\n\ntwo *x*\n\n> q1\n>\n> q2\n\ncode\n  indented";
    for (const wrapper of ["div", "section"] as const) {
      const files = hierarchyFiles(flatNav(["Wrapped"], ["text/vol1.xhtml#ch1"]), {
        "text/vol1.xhtml": `<html><body>${body(wrapper)}</body></html>`,
      });
      const book = parseEpub(pack(files));
      const chapter = book.chapters[0];
      expect(readChapter(book, 0)).toMatchObject({ part: 0, totalParts: 1, text: expected });
      expect(bookToc(book)[0].chars).toBe(expected.length);
      expect(chapter.markdown).toBe(expected);
    }
  });

  it("AC5/R5: multi-slice chapters join markdown with \n\n so headings start their own line", () => {
    const files = hierarchyFiles(
      flatNav(["B"], ["text/vol1.xhtml#b"]),
      { "text/vol1.xhtml": '<html><body>intro <h2 id="a">Two</h2>a-text <p id="b">owned</p></body></html>' },
    );
    const book = parseEpub(pack(files));
    const chapter = book.chapters[0];
    // Chapter B owns the leading slice plus the unclaimed anchor `a` slice.
    const result = readChapter(book, 0);
    expect(result.text).toBe("intro\n\n## Two\n\na-text\n\nowned");
    expect(result.text.split("\n\n")).toContain("## Two");
    // Chapter-level dense guard: stripped markdown dense-equals flat text (R5).
    const stripped = result.text
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, ""))
      .join("")
      .split("*")
      .join("");
    expect(stripped.replace(/\s+/g, "")).toBe(chapter.text.replace(/\s+/g, ""));
  });
});

describe("buildOwnedChapters unit coverage", () => {
  const file = "text/vol1.xhtml";
  const nodes = (entries: Array<[string, string, number]>): NavNode[] =>
    entries.map(([label, href, depth]) => ({ label, href: `${file}${href}`, depth }));

  it("propagates an unclaimed file before any claimer to the first chapter", () => {
    const spine = [file, "text/only.xhtml"];
    const chapters = buildOwnedChapters(
      nodes([["Only", "#a", 0]]),
      spine,
      [
        [{ text: "unclaimed head" }],
        [{ anchorId: "a", text: "owned" }],
      ],
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0].text).toBe("unclaimed headowned");
    expect(chapters[0].hrefs).toEqual([file, "text/only.xhtml"]);
  });
});

describe("TOC parents with only a heading of their own", () => {
  const file = "text/vol1.xhtml";
  const nodes = (entries: Array<[string, string, number]>): NavNode[] =>
    entries.map(([label, href, depth]) => ({ label, href, depth }));

  it("join their first sub-entry instead of standing as a chapter", () => {
    const chapters = buildOwnedChapters(
      nodes([["一", `${file}#c1`, 0], ["一.1", `${file}#s1`, 1], ["一.2", `${file}#s2`, 1], ["二", "text/vol2.xhtml", 0], ["二.1", "text/vol2.xhtml#s1", 1]]),
      [file, "text/vol2.xhtml"],
      [
        [{ anchorId: "c1", text: "一" }, { anchorId: "s1", text: "一.1 正文" }, { anchorId: "s2", text: "一.2 正文" }],
        [{ text: "二" }, { anchorId: "s1", text: "二.1 正文" }],
      ],
    );
    expect(chapters.map((chapter) => [chapter.label, chapter.text, chapter.hrefs])).toEqual([
      ["一.1", "一一.1 正文", [`${file}#c1`, `${file}#s1`]],
      ["一.2", "一.2 正文", [`${file}#s2`]],
      ["二.1", "二二.1 正文", ["text/vol2.xhtml", "text/vol2.xhtml#s1"]],
    ]);
    expect(chapters[2].ancestors).toEqual(["二"]);
  });

  it("join through nested heading-only parents, on title pages of their own", () => {
    const chapters = buildOwnedChapters(
      nodes([["第一部", "text/part.xhtml", 0], ["第一章", `${file}#c1`, 1], ["1.1", `${file}#s1`, 2]]),
      ["text/part.xhtml", file],
      [[{ text: "第一部" }], [{ anchorId: "c1", text: "第一章" }, { anchorId: "s1", text: "正文" }]],
    );
    expect(chapters.map((chapter) => [chapter.label, chapter.text])).toEqual([["1.1", "第一部第一章正文"]]);
  });

  it("keep a lead longer than a heading, and a heading with no sub-entry chapter", () => {
    const intro = "导".repeat(201);
    const chapters = buildOwnedChapters(
      nodes([["一", `${file}#c1`, 0], ["一.1", `${file}#s1`, 1], ["二", `${file}#c2`, 0], ["二.1", `${file}#gone`, 1], ["三", `${file}#c3`, 0]]),
      [file],
      [[{ anchorId: "c1", text: intro }, { anchorId: "s1", text: "一.1" }, { anchorId: "c2", text: "二" }, { anchorId: "c3", text: "三" }]],
    );
    expect(chapters.map((chapter) => [chapter.label, chapter.text])).toEqual([["一", intro], ["一.1", "一.1"], ["二", "二"], ["三", "三"]]);
  });
});

describe("locateQuote", () => {
  const chapter = (label: string, markdown: string, href: string) => ({
    label,
    ancestors: ["第一卷"],
    depth: 1,
    hrefs: [href],
    text: markdown,
    markdown,
  });
  const book: ParsedBook = {
    metadata: { title: "T", author: "A", language: "zh", totalChapters: 2 },
    chapters: [
      chapter("第一章", "# 第一章\n\n自由不是没有约束，而是**选择**约束。\n\n> 他说：“我们终将归来。”", "a.xhtml"),
      chapter("第二章", "第二段开头。中间有很多很多文字。结尾在这里。\n\nThe Quick  Brown Fox.", "b.xhtml#c2"),
    ],
    trigramIndex: new Map(),
  };

  it("verifies a quote in the cited chapter and returns its paragraph", () => {
    const result = locateQuote(book, 0, "“自由不是没有约束，而是选择约束。”");
    expect(result).toMatchObject({
      status: "verified",
      chapterIndex: 0,
      chapterTitle: "第一卷 › 第一章",
      href: "a.xhtml",
      passage: "自由不是没有约束，而是选择约束。",
    });
    expect(result.passage!.slice(result.matchStart, result.matchEnd)).toBe("自由不是没有约束，而是选择约束。");
  });

  it("ignores whitespace, width, case and quote style differences", () => {
    expect(locateQuote(book, 1, "the quick brown fox").status).toBe("verified");
    expect(locateQuote(book, 0, '我们终将归来').passage).toBe("他说：“我们终将归来。”");
    expect(locateQuote(book, 0, "自由不是没有约束,而是选择约束").status).toBe("verified");
  });

  it("matches ellipsis-separated segments in order within one paragraph", () => {
    const result = locateQuote(book, 1, "第二段开头……结尾在这里");
    expect(result.status).toBe("verified");
    expect(result.passage!.slice(result.matchStart, result.matchEnd)).toBe("第二段开头。中间有很多很多文字。结尾在这里");
    expect(locateQuote(book, 1, "结尾在这里……第二段开头").status).toBe("unverified");
  });

  it("relocates a quote found in another chapter", () => {
    expect(locateQuote(book, 0, "中间有很多很多文字")).toMatchObject({
      status: "relocated",
      chapterIndex: 1,
      href: "b.xhtml#c2",
    });
  });

  it("reports quotes that are not in the Book, or too short to check", () => {
    expect(locateQuote(book, 0, "书里没有这句话")).toEqual({ status: "unverified", chapterIndex: 0 });
    expect(locateQuote(book, 0, "“自”")).toEqual({ status: "unverified", chapterIndex: 0 });
    expect(locateQuote(book, 99, "中间有很多很多文字").status).toBe("relocated");
  });

  it("caps long paragraphs around the match", () => {
    const long = `${"前".repeat(800)}目标句子在此${"后".repeat(800)}`;
    const longBook: ParsedBook = { ...book, chapters: [chapter("长", long, "c.xhtml")] };
    const result = locateQuote(longBook, 0, "目标句子在此");
    expect(result.passage!.length).toBeLessThanOrEqual(602);
    expect(result.passage!.startsWith("…")).toBe(true);
    expect(result.passage!.endsWith("…")).toBe(true);
    expect(result.passage!.slice(result.matchStart, result.matchEnd)).toBe("目标句子在此");
  });
});

describe("bookToc parts", () => {
  it("reports the same part count read_chapter uses", () => {
    const paragraph = "字".repeat(5_000);
    const long = Array.from({ length: 6 }, () => paragraph).join("\n\n");
    const book: ParsedBook = {
      metadata: { title: "T", author: "A", language: "zh", totalChapters: 2 },
      chapters: [
        { label: "短", ancestors: [], depth: 0, hrefs: ["a.xhtml"], text: "短文", markdown: "短文" },
        { label: "长", ancestors: [], depth: 0, hrefs: ["b.xhtml"], text: long, markdown: long },
      ],
      trigramIndex: new Map(),
    };
    const toc = bookToc(book);
    expect(long.length).toBeGreaterThan(CHAPTER_PART_CHARS * 2);
    expect(toc[0].parts).toBe(1);
    expect(toc[1].parts).toBe(readChapter(book, 1).totalParts);
    expect(toc[1].parts).toBeGreaterThan(1);
  });
});

describe("book images", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  function imageBook(): ParsedBook {
    const files: Record<string, Uint8Array> = Object.fromEntries(
      Object.entries(
        baseFiles(
          `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="fig" href="images/fig%201.png" media-type="image/png"/>
          <item id="css" href="style.css" media-type="text/css"/>`,
          '<itemref idref="one"/>',
          {
            "nav.xhtml": '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="text/one.xhtml">One</a></nav></body></html>',
            "text/one.xhtml": '<html><body><p>Before the figure.</p><p><img src="../images/fig%201.png" alt="Sales chart"/></p><p>After the figure.</p></body></html>',
            "style.css": "p {}",
          },
        ),
      ).map(([path, text]) => [path, strToU8(text)]),
    );
    files["OPS/images/fig 1.png"] = PNG;
    const zipped = zipSync(files);
    return parseEpub(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer);
  }

  it("shows placeholders with package paths in read_chapter but keeps them out of flat text", () => {
    const book = imageBook();
    expect(readChapter(book, 0).text).toBe("Before the figure.\n\n![Sales chart](OPS/images/fig%201.png)\n\nAfter the figure.");
    expect(book.chapters[0].text).toBe("Before the figure.After the figure.");
    expect(searchBook(book, ["Sales chart"])).toEqual([]);
    expect(locateQuote(book, 0, "After the figure.")).toMatchObject({ status: "verified", passage: "After the figure." });
  });

  it("reads a manifest image by its placeholder src", () => {
    const book = imageBook();
    expect(readImageFile(book, "OPS/images/fig%201.png")).toEqual({ src: "OPS/images/fig%201.png", mediaType: "image/png", bytes: PNG });
    expect(readImageFile(book, "OPS/images/fig 1.png").bytes).toEqual(PNG);
  });

  it("refuses paths that are not manifest images", () => {
    const book = imageBook();
    expect(() => readImageFile(book, "OPS/style.css")).toThrow("No image at OPS/style.css");
    expect(() => readImageFile(book, "OPS/images/missing.png")).toThrow("No image");
  });
});

describe("footnotes", () => {
  const EPUB_NS = 'xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"';

  function footnoteBook(files: FileMap, spine: string[], nav: Array<[string, string]>): ParsedBook {
    const items = spine
      .map((href, index) => `<item id="s${index}" href="${href}" media-type="application/xhtml+xml"/>`)
      .join("");
    return parseEpub(pack(baseFiles(
      `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${items}`,
      spine.map((_, index) => `<itemref idref="s${index}"/>`).join(""),
      {
        "nav.xhtml": `<html ${EPUB_NS}><body><nav epub:type="toc">${nav.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}</nav></body></html>`,
        ...files,
      },
    )));
  }

  it("renders an epub:type noteref as [^label] without splitting its paragraph and appends the aside definition", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>吾生也有涯<a epub:type="noteref" href="#fn1" id="r1"><sup>1</sup></a>，而知也无涯。</p><p>下一段。</p><aside epub:type="footnote" id="fn1"><p>出自《养生主》。</p></aside></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toContain("吾生也有涯[^1]，而知也无涯。\n\n下一段。");
    expect(text.endsWith("[^1]: 出自《养生主》。")).toBe(true);
    expect(book.chapters[0].text).toContain("吾生也有涯1，而知也无涯。");
  });

  it("resolves cross-file endnotes, strips their backlinks, and does not treat backlinks as noterefs", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>正文甲<sup><a id="r1" href="notes.xhtml#n1">[1]</a></sup>与正文乙<sup><a id="r2" href="notes.xhtml#n2">[2]</a></sup>。</p></body></html>`,
        "text/notes.xhtml": `<html ${EPUB_NS}><body><h1>注释</h1><p><sup><a id="n1" href="c1.xhtml#r1">[1]</a></sup>第一条注释。</p><p id="n2"><a href="c1.xhtml#r2">[2]</a> 第二条<em>注释</em>。</p></body></html>`,
      },
      ["text/c1.xhtml", "text/notes.xhtml"],
      [["一", "text/c1.xhtml"], ["注释", "text/notes.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toBe("正文甲[^1]与正文乙[^2]。\n\n[^1]: 第一条注释。\n[^2]: 第二条*注释*。");
    const notes = readChapter(book, 1).text;
    expect(notes).not.toContain("[^");
    expect(notes).toContain("[1]第一条注释。");
  });

  it("only appends definitions for noterefs inside the requested part", () => {
    const filler = "填充文字。".repeat(Math.ceil(CHAPTER_PART_CHARS / 5));
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>开头<a epub:type="noteref" href="#a">a</a></p><p>${filler}</p><p>结尾<a epub:type="noteref" href="#b">*</a></p><aside epub:type="footnote" id="a">注甲</aside><aside epub:type="footnote" id="b">注乙</aside></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    const first = readChapter(book, 0, 0);
    expect(first.totalParts).toBeGreaterThan(1);
    expect(first.text).toContain("开头[^a]");
    expect(first.text).toContain("[^a]: 注甲");
    expect(first.text).not.toContain("[^*]: ");
    const last = readChapter(book, 0, first.totalParts - 1).text;
    expect(last).toContain("结尾[^*]");
    expect(last).toContain("[^*]: 注乙");
  });

  it("gives distinct labels to different notes sharing the same marker text", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>甲<a epub:type="noteref" href="#x">*</a>乙<a epub:type="noteref" href="#y">*</a>丙<a epub:type="noteref" href="#x">*</a></p><aside epub:type="footnote" id="x">注X</aside><aside epub:type="footnote" id="y">注Y</aside></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toContain("甲[^*]乙[^*-2]丙[^*]");
    expect(text).toContain("[^*]: 注X\n[^*-2]: 注Y");
  });

  it("keeps the Markdown structure of a section whose notes are a pandoc-style list", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><section id="s1"><h2>一节</h2><p>正文<a href="#fn1" class="footnote-ref" id="fnref1" epub:type="noteref">1</a>继续。</p><p>第二段<em>强调</em>。</p></section><section class="footnotes" epub:type="footnotes"><hr /><ol><li id="fn1" epub:type="footnote"><p>注释内容。<a href="#fnref1" class="footnote-back" role="doc-backlink">↩︎</a></p></li></ol></section></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一节", "text/c1.xhtml#s1"]],
    );
    const { text } = readChapter(book, 0);
    expect(text.startsWith("## 一节\n\n正文[^1]继续。\n\n第二段*强调*。")).toBe(true);
    expect(text.endsWith("\n\n[^1]: 注释内容。")).toBe(true);
  });

  it("leaves ordinary links and links to missing targets as plain text", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>见<a href="#sec">第二节</a>与<sup><a href="#missing">9</a></sup>。</p><p id="sec">第二节内容</p></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    expect(readChapter(book, 0).text).toBe("见第二节与<sup>9</sup>。\n\n第二节内容");
  });

  it("locates quotes whether or not they carry footnote markers", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>吾生也有涯<a epub:type="noteref" href="#fn1">1</a>，而知也无涯。</p><aside epub:type="footnote" id="fn1">出自《养生主》。</aside></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    expect(locateQuote(book, 0, "吾生也有涯，而知也无涯").status).toBe("verified");
    expect(locateQuote(book, 0, "吾生也有涯[^1]，而知也无涯").status).toBe("verified");
  });

  it("recognizes plain bracketed links paired with backlinks as footnotes", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>正文甲<a id="r1" href="#n1">[1]</a>，正文乙<a id="r2" href="notes.xhtml#n2">〔2〕</a>。</p><p><a id="n1" href="#r1">[1]</a>本章注一。</p></body></html>`,
        "text/notes.xhtml": `<html ${EPUB_NS}><body><h1>注释</h1><p id="n2"><a href="c1.xhtml#r2">〔2〕</a>书末注二。</p></body></html>`,
      },
      ["text/c1.xhtml", "text/notes.xhtml"],
      [["一", "text/c1.xhtml"], ["注释", "text/notes.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toContain("正文甲[^1]，正文乙[^2]。");
    expect(text).toContain("[^1]: 本章注一。\n[^2]: 书末注二。");
  });

  it("recognizes circled, 注-prefixed and footnote-classed image references", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>甲<a href="#a">①</a>乙<a href="#b">注2</a>丙<a class="duokan-footnote" href="#c"><img src="note.png" alt="注"/></a></p><ol class="duokan-footnote-content"><li id="a">注A</li><li id="b">注B</li><li id="c">注C</li></ol></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toContain("甲[^①]乙[^注2]丙[^c]");
    expect(text).toContain("[^①]: 注A\n[^注2]: 注B\n[^c]: 注C");
  });

  it("does not treat plain marker links to headings or parenthesized references as footnotes", () => {
    const book = footnoteBook(
      {
        "text/c1.xhtml": `<html ${EPUB_NS}><body><p>见<a href="#s1">[1]</a>与式<a href="#eq1">(1)</a>。</p><h2 id="s1">第一节</h2><p id="eq1">E = mc2</p></body></html>`,
      },
      ["text/c1.xhtml"],
      [["一", "text/c1.xhtml"]],
    );
    const { text } = readChapter(book, 0);
    expect(text).toContain("见[1]与式(1)。");
    expect(text).not.toContain("[^");
  });
});

describe("rich inline content", () => {
  function singleFileBook(body: string): ParsedBook {
    return parseEpub(pack(baseFiles(
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>',
      '<itemref idref="c1"/>',
      {
        "nav.xhtml": '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="text/c1.xhtml">一</a></nav></body></html>',
        "text/c1.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:m="http://www.w3.org/1998/Math/MathML"><body>${body}</body></html>`,
      },
    )));
  }

  it("keeps superscripts, subscripts and external links, leaving in-book links as text", () => {
    expect(markdownText('<html><body><p>H<sub>2</sub>O 与 x<sup>2</sup>，见<a href="https://example.com/a b">官网</a>、<a href="ch2.xhtml#s">第二章</a>与<a href="https://example.com">https://example.com</a>。</p></body></html>'))
      .toBe("H<sub>2</sub>O 与 x<sup>2</sup>，见[官网](https://example.com/a%20b)、第二章与https://example.com。");
  });

  it("repeats rowspan cells in every row they cover", () => {
    const html = `<html><body><table><tr><th>地区</th><th>年份</th><th>人口</th></tr>
      <tr><td rowspan="2">华东</td><td>1990</td><td>1</td></tr><tr><td>2000</td><td>2</td></tr>
      <tr><td>华北</td><td rowspan="0" colspan="2">缺</td></tr><tr><td>华南</td></tr></table></body></html>`;
    expect(markdownText(html)).toBe(
      "| 地区 | 年份 | 人口 |\n| --- | --- | --- |\n| 华东 | 1990 | 1 |\n| 华东 | 2000 | 2 |\n| 华北 | 缺 |  |\n| 华南 | 缺 |  |",
    );
  });

  it("renders MathML as LaTeX, preferring a TeX annotation", () => {
    const converted = '<math><mfrac><mi>a</mi><mrow><mi>b</mi><mo>+</mo><mn>1</mn></mrow></mfrac><mo>=</mo><msqrt><msup><mi>x</mi><mn>2</mn></msup></msqrt><mo>≤</mo><msubsup><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><msub><mi>α</mi><mi>i</mi></msub></math>';
    expect(markdownText(`<html><body><p>式 ${converted} 成立。</p></body></html>`))
      .toBe("式 $\\frac{a}{b+1}=\\sqrt{x^2}\\le\\sum_{i=1}^n\\alpha_i$ 成立。");
    const annotated = '<m:math display="block"><m:semantics><m:mi>E</m:mi><m:annotation encoding="application/x-tex">E = mc^2</m:annotation></m:semantics></m:math>';
    expect(markdownText(`<html xmlns:m="http://www.w3.org/1998/Math/MathML"><body><p>${annotated}</p></body></html>`)).toBe("$$E = mc^2$$");
  });

  it("keeps the chapter's Markdown structure around the new markup and searches the flat math text", () => {
    const book = singleFileBook('<h2>一节</h2><p>能量 <m:math><m:mi>E</m:mi><m:mo>=</m:mo><m:mi>m</m:mi><m:msup><m:mi>c</m:mi><m:mn>2</m:mn></m:msup></m:math>，水 H<sub>2</sub>O，<a href="https://example.com">链接</a>。</p><table><tr><td rowspan="2">甲</td><td>1</td></tr><tr><td>2</td></tr></table>');
    const { text } = readChapter(book, 0);
    expect(text).toBe("## 一节\n\n能量 $E=mc^2$，水 H<sub>2</sub>O，[链接](https://example.com)。\n\n| 甲 | 1 |\n| --- | --- |\n| 甲 | 2 |");
    expect(book.chapters[0].text).toContain("能量 E=mc2，水 H2O，链接。");
    expect(searchBook(book, ["E=mc2"])).toHaveLength(1);
    expect(locateQuote(book, 0, "水 H<sub>2</sub>O，[链接](https://example.com)").status).toBe("verified");
  });
});
