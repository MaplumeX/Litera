import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookToc, buildOwnedChapters, hrefFragment, parseEpub, parseSpineSegments, readChapter, searchBook, stripFragment, type NavNode } from "./epub-content";

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
      { text: "plain text" },
    ]);
  });

  it("slices at anchor elements first/middle/last", () => {
    const source =
      '<html><body>intro <h1 id="a">One</h1>first <h2 id="b">Two</h2>second tail</body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "intro" },
      { anchorId: "a", text: "Onefirst" },
      { anchorId: "b", text: "Twosecond tail" },
    ]);
  });

  it("supports EPUB2 <a name> anchors", () => {
    const source = '<html><body><a name="start"></a>opened body</body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "" },
      { anchorId: "start", text: "opened body" },
    ]);
  });

  it("treats inline-span anchors as segment boundaries", () => {
    const source = '<html><body><p>alpha <span id="mid">beta</span> gamma</p></body></html>';
    expect(parseSpineSegments(source)).toEqual([
      { text: "alpha" },
      { anchorId: "mid", text: "beta gamma" },
    ]);
  });

  it("falls back to a single htmlText segment on malformed markup", () => {
    const source = "<html><body><p>unclosed <div>text";
    const segments = parseSpineSegments(source);
    expect(segments).toHaveLength(1);
    expect(segments[0].anchorId).toBeUndefined();
    expect(segments[0].text).toContain("unclosed");
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
    expect(readChapter(book, 0).text).toBe("introorphanownedtrailing");
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
    for (const { buffer, spine } of fixtures) {
      const book = parseEpub(buffer);
      const chapterText = book.chapters.map((chapter) => chapter.text).join("");
      const spineText = spine.map((href) => fileText(buffer, href)).join("");
      expect(sorted(chapterText)).toBe(sorted(spineText));
      expect(dense(chapterText)).toBe(dense(spineText));
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
