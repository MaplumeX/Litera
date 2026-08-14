import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { bookToc, parseEpub, readChapter, searchBook } from "./epub-content";

function epub(options: { nav?: boolean; ncx?: boolean } = { nav: true }): ArrayBuffer {
  const navItem = options.nav
    ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    : "";
  const ncxItem = options.ncx
    ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    : "";
  const files: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
    ),
    "OPS/book.opf": strToU8(`
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Fixture</dc:title><dc:creator>Author</dc:creator><dc:language>zh</dc:language></metadata>
        <manifest>${navItem}${ncxItem}
          <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
          <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
          <item id="three" href="text/three.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/></spine>
      </package>`),
    "OPS/nav.xhtml": strToU8(
      '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a href="cover.xhtml">Cover</a></nav><nav epub:type="toc"><a href="text/one.xhtml">Opening</a><a href="text/three.xhtml">Ending</a></nav></body></html>',
    ),
    "OPS/toc.ncx": strToU8(
      '<ncx><navMap><navPoint><navLabel><text>Opening</text></navLabel><content src="text/one.xhtml"/></navPoint><navPoint><navLabel><text>Ending</text></navLabel><content src="text/three.xhtml"/></navPoint></navMap></ncx>',
    ),
    "OPS/text/one.xhtml": strToU8("<html><body>alpha exact phrase</body></html>"),
    "OPS/text/two.xhtml": strToU8("<html><body>middle split chapter text</body></html>"),
    "OPS/text/three.xhtml": strToU8("<html><body>omega second token</body></html>"),
  };
  const bytes = zipSync(files);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("browser EPUB projection", () => {
  it("uses EPUB 3 TOC ownership and merges split spine content", () => {
    const book = parseEpub(epub({ nav: true }));
    expect(book.metadata).toEqual({ title: "Fixture", author: "Author", language: "zh", totalChapters: 2 });
    expect(bookToc(book)).toMatchObject([
      { index: 0, label: "Opening", hrefs: ["OPS/text/one.xhtml", "OPS/text/two.xhtml"] },
      { index: 1, label: "Ending", hrefs: ["OPS/text/three.xhtml"] },
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
