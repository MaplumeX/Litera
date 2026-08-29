import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookToc, buildOwnedChapters, chapterWindows, hrefFragment, markdownText, parseEpub, parseSpineSegments, readChapter, searchBook, stripFragment, type NavNode } from "./epub-content";

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

  it("renders img/svg/audio/video as empty and keeps br as an in-paragraph break", () => {
    expect(markdownText('<html><body><p>a<img src="x"/><svg></svg><br/>b</p></body></html>')).toBe("a\nb");
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

  it("keeps unknown elements transparent and tables as plain block text", () => {
    expect(markdownText('<html><body><article><p>kept</p></article><table><tr><td>cell</td></tr></table></body></html>')).toBe("kept\n\ncell");
  });

  it("returns empty for unparsable roots", () => {
    expect(markdownText("<html><body></body></html>")).toBe("");
  });
});

describe("chapterWindows", () => {
  it("greedily packs paragraph blocks into <=12k windows and rejoins exactly", () => {
    const paragraphs = ["a".repeat(6000), "b".repeat(5000), "c".repeat(2000)];
    const markdown = paragraphs.join("\n\n");
    const windows = chapterWindows(markdown);
    expect(windows).toEqual([`${paragraphs[0]}\n\n${paragraphs[1]}`, paragraphs[2]]);
    windows.forEach((window) => expect(window.length).toBeLessThanOrEqual(12_000));
    expect(windows.join("\n\n")).toBe(markdown);
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
