import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import {
  CHAPTER_PART_CHARS,
  hrefMatches,
  type BookMetadata,
  type BookTocEntry,
  type QuoteLocation,
  type SearchHit,
} from "./book-content";
import { isMathElement, mathMarkdown, mathText } from "./mathml";

interface ManifestItem {
  href: string;
  mediaType: string;
  properties: string;
}

export interface NavNode {
  label: string;
  /** Resolved href; keeps the `#fragment` when the TOC entry carries one. */
  href: string;
  /** TOC nesting depth, 0 = top level. */
  depth: number;
}

export interface Segment {
  /** Anchor id that starts this slice; undefined for the leading slice. */
  anchorId?: string;
  text: string;
  /** Structured Markdown projection of the same slice; flat `text` when the markdown walk failed. */
  markdown?: string;
}

interface Chapter {
  label: string;
  ancestors: string[];
  depth: number;
  hrefs: string[];
  text: string;
  markdown: string;
  /** Footnote definitions by label, for the `[^label]` markers in `markdown`. */
  footnotes?: ReadonlyMap<string, string>;
}

export interface ParsedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
  trigramIndex: Map<string, number[]>;
  /** The zipped EPUB, kept so images can be inflated on demand. */
  archive: Uint8Array;
  /** Package path → media type of every image in the manifest. */
  images: Map<string, string>;
}

/** Raw bytes of one packaged image. */
export interface BookImageFile {
  src: string;
  mediaType: string;
  bytes: Uint8Array;
}

const parseXml = (source: string, mime = "application/xml") =>
  new DOMParser().parseFromString(source, mime);

function directory(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

export function resolveHref(baseFile: string, relative: string): string {
  const hashIndex = relative.indexOf("#");
  const target = hashIndex >= 0 ? relative.slice(0, hashIndex) : relative;
  const fragment = hashIndex >= 0 ? relative.slice(hashIndex) : "";
  const parts = `${directory(baseFile)}${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/") + fragment;
}

/** Strip a `#fragment`; used where only the file path is meaningful (OPF manifest/spine). */
export function stripFragment(href: string): string {
  return href.split("#")[0];
}

export function hrefFragment(href: string): string {
  const hashIndex = href.indexOf("#");
  return hashIndex >= 0 ? href.slice(hashIndex + 1) : "";
}

function fileText(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path] ?? files[path.replace(/^\//, "")];
  return bytes ? strFromU8(bytes) : "";
}

function firstText(root: ReturnType<typeof parseXml>, names: string[], fallback: string): string {
  for (const name of names) {
    const value = root.getElementsByTagName(name)[0]?.textContent?.trim();
    if (value) return value;
  }
  return fallback;
}

const INLINE_EMPTY_TAGS = new Set(["img", "svg", "audio", "video", "image"]);
const IMAGE_TAGS = new Set(["img", "svg", "image"]);
const BLOCK_TAGS = new Set(["p", "div", "section", "header", "footer", "aside"]);
const IMAGE_ALT_MAX_CHARS = 200;
/** An image placeholder in the Markdown projection: `![alt](src)`. */
const IMAGE_PLACEHOLDER = /!\[([^\]\n]*)\]\(([^)\s]+)\)/g;

function imageSource(element: XmlElement): string {
  const src = element.getAttribute("src") || element.getAttribute("xlink:href") || element.getAttribute("href") || "";
  // Only images packaged in the EPUB can be viewed; data URIs and remote URLs are dropped.
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src) ? "" : src.trim();
}

function imageAlt(element: XmlElement): string {
  const alt = element.getAttribute("alt") || element.getAttribute("title") || "";
  return alt.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, IMAGE_ALT_MAX_CHARS);
}

/**
 * Markdown-only markup with no counterpart in the flat text (link brackets
 * and targets, `<sup>`/`<sub>` tags, math, repeated rowspan cells) is wrapped
 * in these noncharacter sentinels while chapters are built. The dense guard
 * and quote matching drop wrapped spans whole; `finalMarkdown` deletes the
 * sentinels before Markdown leaves this module.
 */
const MARKUP_SENTINELS = /[\uFDD0\uFDD1]/g;
const MARKUP_SPAN = /\uFDD0[^\uFDD1]*\uFDD1/g;

function markup(text: string): string {
  return text ? `\uFDD0${text.replace(MARKUP_SENTINELS, "")}\uFDD1` : "";
}

function withoutMarkup(markdown: string): string {
  return markdown.replace(MARKUP_SPAN, "");
}

function finalMarkdown(markdown: string): string {
  return markdown.replace(MARKUP_SENTINELS, "");
}

/** Percent-encode the characters that would end a Markdown link target early. */
function escapeImageSource(src: string): string {
  return src.replace(/[\s()]/g, (char) => (char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char)));
}

/**
 * Markdown placeholders for an image element: one `![alt](src)` per packaged
 * image (`<img>`, or the `<image>` elements of an `<svg>`), `src` still
 * relative to its spine file until `resolveImageRefs` rewrites it.
 */
function imagePlaceholders(element: XmlElement): string {
  const tag = elementTag(element);
  const images = tag === "svg" ? Array.from(element.getElementsByTagName("image")) : [element];
  return images
    .map((image) => {
      const src = imageSource(image);
      return src ? `![${imageAlt(image)}](${escapeImageSource(src)})` : "";
    })
    .join("");
}

/** Rewrite placeholder sources from spine-file-relative to EPUB package paths. */
export function resolveImageRefs(markdown: string, fileHref: string): string {
  return markdown.replace(IMAGE_PLACEHOLDER, (_, alt: string, src: string) => `![${alt}](${resolveHref(fileHref, src)})`);
}

/** Drop image placeholders; they have no counterpart in the flat text projection. */
function withoutImages(markdown: string): string {
  return markdown.replace(IMAGE_PLACEHOLDER, "");
}

/**
 * Normalize inline text: collapse whitespace runs to a single space and
 * trim — but keep `<br/>`-produced line breaks (`\n`) as paragraph-internal
 * hard breaks, collapsing whitespace only within each line.
 */
function collapseInline(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
}

/** Verbatim pre-content: raw text nodes preserved, `<br/>` → `\n`, no collapsing. */
function preText(node: XmlNode): string {
  const type = node.nodeType;
  if (type === 3 || type === 4) return node.nodeValue ?? "";
  if (type !== 1) return "";
  const element = node as XmlElement;
  const tag = elementTag(element);
  if (tag === "br") return "\n";
  if (INLINE_EMPTY_TAGS.has(tag)) return "";
  let out = "";
  const children = element.childNodes;
  for (let index = 0; index < children.length; index += 1) out += preText(children[index]);
  return out;
}

interface MarkdownWalk {
  /** Block-level output: paragraphs, headings, quotes, lists, pre blocks. */
  blocks: string[];
}

interface MarkdownItem {
  /** Item text (single block or `\n\n`-joined blocks for loose items). */
  text: string;
  /** Nested list elements to render indented after this item. */
  nested: XmlElement[];
}

/** Markdown projection walk for one element subtree. */
function walkElement(element: XmlElement, state: MarkdownWalk): void {
  const tag = elementTag(element);
  if (tag === "pre") {
    let raw = "";
    const children = element.childNodes;
    for (let index = 0; index < children.length; index += 1) raw += preText(children[index]);
    state.blocks.push(raw);
    return;
  }
  if (tag === "table") {
    state.blocks.push(...tableBlocks(element));
    return;
  }
  if (tag === "ul" || tag === "ol") {
    const lines = listBlocks(element, tag === "ol");
    if (lines.length) state.blocks.push(lines.join("\n"));
    return;
  }
  if (tag === "blockquote") {
    const inner: MarkdownWalk = { blocks: [] };
    const children = element.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.nodeType === 3 || child.nodeType === 4) {
        // Bare text inside a quote renders as its own quoted paragraph.
        const text = collapseInline(child.nodeValue ?? "");
        if (text) inner.blocks.push(text);
        continue;
      }
      if (child.nodeType === 1) walkElement(child as XmlElement, inner);
    }
    const quote = inner.blocks.join("\n\n");
    if (quote) state.blocks.push(quote.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
    return;
  }
  const heading = /^h[1-6]$/.exec(tag);
  if (heading) {
    const text = collapseInline(inlineOf(element));
    if (text) state.blocks.push(`${"#".repeat(Number(tag.slice(1)))} ${text}`);
    return;
  }
  if (BLOCK_TAGS.has(tag) && !hasBlockDescendant(element)) {
    // Purely inline block content (the common `<p>` case): one collapsed
    // paragraph. A block wrapper with block children (e.g. a `<div>` of
    // `<p>`/headings — the dominant real-book shape) falls through to the
    // transparent flush-and-recurse branch so the nested blocks emit their
    // own structure instead of being flattened.
    const text = collapseInline(inlineOf(element));
    if (text) state.blocks.push(text);
    return;
  }
  // Transparent: recurse into children without emitting this element's own
  // block. Pure-inline children accumulate into one paragraph; block roots
  // (or subtrees containing them) flush the accumulated text and emit their
  // own blocks.
  let text = "";
  const children = element.childNodes;
  const flushText = () => {
    const block = collapseInline(text);
    text = "";
    if (block) state.blocks.push(block);
  };
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 3 || child.nodeType === 4) {
      text += child.nodeValue ?? "";
      continue;
    }
    if (child.nodeType !== 1) continue;
    const childElement = child as XmlElement;
    if (isMarkdownBlockRoot(childElement) || hasBlockDescendant(childElement)) {
      flushText();
      walkElement(childElement, state);
    } else {
      text += inlineOf(childElement);
    }
  }
  flushText();
}

/** Inline Markdown projection of an element subtree; returns text with block structure dropped. */
function inlineOf(element: XmlElement): string {
  // Delegate to `inlineNode` so the element's OWN emphasis delimiters apply
  // too — recursing children directly drops the `*…*` of a pure-inline `<em>`.
  return inlineNode(element);
}

function inlineNode(node: XmlNode): string {
  const type = node.nodeType;
  if (type === 3 || type === 4) return node.nodeValue ?? "";
  if (type !== 1) return "";
  const element = node as XmlElement;
  const label = noterefLabel(element);
  if (label) return `[^${label}]`;
  if (isMathElement(element)) return markup(mathMarkdown(element));
  const tag = elementTag(element);
  if (IMAGE_TAGS.has(tag)) return imagePlaceholders(element);
  if (INLINE_EMPTY_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  const children = element.childNodes;
  let text = "";
  for (let index = 0; index < children.length; index += 1) text += inlineNode(children[index]);
  if (tag === "em" || tag === "i") return text ? `*${text}*` : text;
  if (tag === "strong" || tag === "b") return text ? `**${text}**` : text;
  if (tag === "del" || tag === "s" || tag === "strike") return text ? `~~${text}~~` : text;
  // A superscript holding only a footnote mark stays the bare `[^label]`.
  if (tag === "sup" || tag === "sub") return withoutFootnoteRefs(text).trim() ? `${markup(`<${tag}>`)}${text}${markup(`</${tag}>`)}` : text;
  if (tag === "a") return linkMarkdown(element, text);
  return text;
}

const EXTERNAL_HREF = /^(?:https?:|mailto:)/i;

/** `[text](href)` for a link out of the book; in-book links keep only their text. */
function linkMarkdown(link: XmlElement, text: string): string {
  const href = (link.getAttribute("href") ?? "").trim();
  if (!EXTERNAL_HREF.test(href)) return text;
  const label = collapseInline(text).trim();
  if (!label || label === href || label === href.replace(/^mailto:/i, "")) return text;
  return `${markup("[")}${text}${markup(`](${escapeImageSource(href)})`)}`;
}

/** Render `<ul>`/`<ol>` as Markdown list lines; nested lists indent two spaces. */
function listBlocks(list: XmlElement, ordered: boolean): string[] {
  const items: MarkdownItem[] = [];
  const children = list.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType !== 1) continue;
    const element = child as XmlElement;
    const tag = elementTag(element);
    if (tag === "li") items.push(listItem(element));
    else if (tag === "ul" || tag === "ol") items.push(...listBlocks(element, tag === "ol").map((text) => ({ text, nested: [] })));
  }
  const lines: string[] = [];
  items.forEach((item, index) => {
    lines.push(`${ordered ? `${index + 1}. ` : "- "}${item.text}`);
    item.nested.forEach((nested) => {
      listBlocks(nested, elementTag(nested) === "ol").forEach((line) => lines.push(`  ${line}`));
    });
  });
  return lines;
}

/** One table cell as a single Markdown line: nested blocks joined by spaces, `|` escaped. */
function tableCell(cell: XmlElement): string {
  const state: MarkdownWalk = { blocks: [] };
  walkElement(cell, state);
  return state.blocks.join(" ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/**
 * The table's own rows (through row groups, never a nested table's), each
 * `colspan` padded with empty cells and each `rowspan` cell repeated in the
 * rows it covers, so every row reads on its own.
 */
function tableRows(table: XmlElement): string[][] {
  const rows: string[][] = [];
  // Column → the cell a rowspan from an earlier row still covers it with.
  const spanning: Array<{ text: string; rows: number } | undefined> = [];
  const visit = (parent: XmlElement) => {
    const children = parent.childNodes;
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index];
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      const tag = elementTag(element);
      if (tag === "thead" || tag === "tbody" || tag === "tfoot") visit(element);
      else if (tag === "tr") {
        const cells: string[] = [];
        const spanned = () => {
          for (let cover = spanning[cells.length]; cover; cover = spanning[cells.length]) {
            cells.push(cover.text);
            cover.rows -= 1;
            if (!cover.rows) spanning[cells.length - 1] = undefined;
          }
        };
        const cellNodes = element.childNodes;
        for (let cellIndex = 0; cellIndex < cellNodes.length; cellIndex += 1) {
          const cellNode = cellNodes[cellIndex];
          if (cellNode.nodeType !== 1) continue;
          const cell = cellNode as XmlElement;
          const cellTag = elementTag(cell);
          if (cellTag !== "td" && cellTag !== "th") continue;
          spanned();
          const text = tableCell(cell);
          const span = Math.min(Number.parseInt(cell.getAttribute("colspan") ?? "", 10) || 1, 100);
          const rowSpan = Number.parseInt(cell.getAttribute("rowspan") ?? "", 10);
          // rowspan="0" covers the rest of the table.
          const below = Math.min(rowSpan === 0 ? 1000 : (rowSpan || 1) - 1, 1000);
          for (let column = 0; column < span; column += 1) {
            const value = column ? "" : text;
            if (below > 0) spanning[cells.length] = { text: markup(value), rows: below };
            cells.push(value);
          }
        }
        spanned();
        if (cells.length) rows.push(cells);
      }
    }
  };
  visit(table);
  return rows;
}

/**
 * Render `<table>` as a GFM table (the first row is the header row GFM
 * requires), preceded by its `<caption>`. A single-column table is usually
 * layout, so its cells become plain paragraphs instead.
 */
function tableBlocks(table: XmlElement): string[] {
  const blocks: string[] = [];
  const children = table.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 1 && elementTag(child) === "caption") {
      const text = collapseInline(inlineOf(child as XmlElement));
      if (text) blocks.push(text);
    }
  }
  const rows = tableRows(table);
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (columns <= 1) {
    for (const [cell] of rows) if (cell) blocks.push(cell.replace(/\\\|/g, "|"));
    return blocks;
  }
  const line = (cells: string[]) =>
    `| ${Array.from({ length: columns }, (_, column) => cells[column] ?? "").join(" | ")} |`;
  const lines = rows.map(line);
  lines.splice(1, 0, `|${" --- |".repeat(columns)}`);
  blocks.push(lines.join("\n"));
  return blocks;
}

function listItem(li: XmlElement): MarkdownItem {
  const inlineParts: string[] = [];
  const blockParts: string[] = [];
  const nested: XmlElement[] = [];
  const children = li.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType === 3 || child.nodeType === 4) {
      const value = child.nodeValue;
      if (value) inlineParts.push(value);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as XmlElement;
    const tag = elementTag(element);
    if (tag === "ul" || tag === "ol") {
      nested.push(element);
      continue;
    }
    if (BLOCK_TAGS.has(tag) || tag === "pre" || tag === "blockquote" || /^h[1-6]$/.test(tag) || tag === "table") {
      const state: MarkdownWalk = { blocks: [] };
      walkElement(element, state);
      if (state.blocks.length) blockParts.push(state.blocks.join("\n\n"));
      continue;
    }
    // Inline markup: use inline projection, but a stray block boundary inside it still forces a break.
    const text = inlineOf(element);
    if (text) inlineParts.push(text);
  }
  const inlineText = collapseInline(inlineParts.join(""));
  return { text: [inlineText, ...blockParts].filter(Boolean).join("\n\n"), nested };
}

/**
 * Structured Markdown projection of one DOM root. `\n\n` separates block
 * paragraphs; inline whitespace collapses to single spaces except inside
 * `<pre>`, whose content stays verbatim. Shares the block-event walk with
 * `parseSpineSegments` so both projections follow identical rules.
 */
export function markdownText(source: string): string {
  const parsed = parseXml(source, "text/html");
  const root = parsed.documentElement;
  if (!root) return "";
  const state: MarkdownWalk = { blocks: [] };
  walkElement(root, state);
  return finalMarkdown(state.blocks.map((block) => block.replace(/\s+$/g, "")).filter(Boolean).join("\n\n"));
}

// Block roots are consumed by `walkElement` as a whole subtree; everything
// else is transparent in the event walk (inline content flows into `buffer`).
function isMarkdownBlockRoot(element: XmlElement): boolean {
  const tag = elementTag(element);
  return (
    tag === "pre" ||
    tag === "table" ||
    tag === "blockquote" ||
    tag === "ul" ||
    tag === "ol" ||
    BLOCK_TAGS.has(tag) ||
    /^h[1-6]$/.test(tag)
  );
}

/** True when any descendant of `element` (not the element itself) is a block root. */
function hasBlockDescendant(element: XmlElement): boolean {
  const children = element.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType !== 1) continue;
    const childElement = child as XmlElement;
    if (isMarkdownBlockRoot(childElement) || hasBlockDescendant(childElement)) return true;
  }
  return false;
}

type MarkdownEvent = { kind: "anchor"; id: string } | { kind: "block"; text: string };

function isAnchored(element: XmlElement): boolean {
  return anchorIdOf(element) !== undefined;
}

/** True when any descendant of `element` (not the element itself) carries an anchor id. */
function hasAnchoredDescendant(element: XmlElement): boolean {
  const children = element.childNodes;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.nodeType !== 1) continue;
    const childElement = child as XmlElement;
    if (isAnchored(childElement) || hasAnchoredDescendant(childElement)) return true;
  }
  return false;
}

/**
 * Event-stream markdown walk: block emissions and anchor boundaries in
 * document order. Anchored elements still wrap their own subtree — an
 * anchored `<p>` emits its anchor then the whole paragraph. Bare inline
 * text between blocks is flushed as a collapsed block at the next boundary.
 * Atomic block roots that anchors cannot cleanly split (`pre`, lists,
 * quotes, tables, headings) are consumed wholesale; a consumer block root
 * (`p`/`div`/`section`/…) runs the anchor-aware transparent walk instead,
 * so nested anchors land as their own slice events — swallowing them would
 * desynchronize the event stream from the flat walk and flatten the whole
 * file via the dense-guard fallback.
 */
function markdownEvents(root: XmlElement): MarkdownEvent[] {
  const events: MarkdownEvent[] = [];
  let buffer = "";
  const flushInline = () => {
    const text = collapseInline(buffer);
    buffer = "";
    if (text) events.push({ kind: "block", text });
  };
  const inlineChild = (element: XmlElement): boolean =>
    !isMarkdownBlockRoot(element) &&
    !hasBlockDescendant(element) &&
    !isAnchored(element) &&
    !hasAnchoredDescendant(element);
  const visit = (node: XmlNode) => {
    const type = node.nodeType;
    if (type === 3 || type === 4) {
      const value = node.nodeValue;
      if (value) buffer += value;
      return;
    }
    if (type !== 1) return;
    const element = node as XmlElement;
    const anchor = anchorIdOf(element);
    if (anchor !== undefined) {
      flushInline();
      events.push({ kind: "anchor", id: anchor });
    }
    if (isMathElement(element)) {
      buffer += markup(mathMarkdown(element));
      return;
    }
    const tag = elementTag(element);
    if (isMarkdownBlockRoot(element) && !BLOCK_TAGS.has(tag)) {
      flushInline();
      const state: MarkdownWalk = { blocks: [] };
      walkElement(element, state);
      for (const block of state.blocks) {
        const text = block.replace(/\s+$/g, "");
        if (text) events.push({ kind: "block", text });
      }
      return;
    }
    if (BLOCK_TAGS.has(tag)) {
      // Container block: mirror walkElement's transparent branch, but flush
      // and recurse at anchored children too, so each nested anchor lands in
      // its own slice; the element itself is a block boundary (end flush).
      const children = element.childNodes;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.nodeType === 3 || child.nodeType === 4) {
          const value = child.nodeValue;
          if (value) buffer += value;
          continue;
        }
        if (child.nodeType !== 1) continue;
        const childElement = child as XmlElement;
        if (inlineChild(childElement)) buffer += inlineOf(childElement);
        else {
          flushInline();
          visit(childElement);
        }
      }
      flushInline();
      return;
    }
    const label = noterefLabel(element);
    if (label) {
      buffer += `[^${label}]`;
      return;
    }
    if (IMAGE_TAGS.has(tag)) {
      buffer += imagePlaceholders(element);
      return;
    }
    if (INLINE_EMPTY_TAGS.has(tag)) return;
    if (tag === "br") {
      buffer += "\n";
      return;
    }
    const children = element.childNodes;
    for (let index = 0; index < children.length; index += 1) visit(children[index]);
  };
  visit(root);
  flushInline();
  return events;
}

/** Dense form: all whitespace removed — used for content-equivalence checks. */
function dense(text: string): string {
  return text.replace(/\s+/g, "");
}

/**
 * Dense content of a Markdown projection: strip structural markers (heading,
 * quote, list line prefixes; emphasis delimiters) first, then remove
 * whitespace. Comparable with `dense` of the flat projection; a mismatch
 * (e.g. literal `*` in the source text) makes the caller fall back to flat
 * text, which is always safe.
 */
function denseMarkdown(markdown: string): string {
  const lines = withoutFootnoteRefs(withoutImages(withoutMarkup(markdown))).split("\n").map((line) => {
    let text = line.replace(/^(\s*)([-+]|\d{1,9}\.)\s+/, "$1");
    text = text.replace(/^(\s*)#{1,6}\s+/, "$1");
    while (/^(\s*)>\s?/.test(text)) text = text.replace(/^(\s*)>\s?/, "$1");
    // Table rows: drop the delimiter row and cell pipes, unescape literal `\|`.
    if (/^\s*\|(?:\s*-{3,}\s*\|)+\s*$/.test(text)) return "";
    if (/^\s*\|/.test(text)) text = text.replace(/\\\||\|/g, (pipe) => (pipe === "|" ? "" : "|"));
    return text;
  });
  return dense(lines.join("\n"))
    .split("**")
    .join("")
    .split("~~")
    .join("")
    .split("*")
    .join("");
}

/**
 * Reduce markdown events into slices aligned with the flat walk's anchor
 * sequence (slice 0 = leading content, then one slice per anchor). Returns
 * `[]` when the markdown anchor stream disagrees with the flat one, so the
 * caller falls back to flat text for every slice.
 */
function markdownSlices(events: readonly MarkdownEvent[], anchorIds: readonly string[]): string[] {
  const slices: string[] = new Array(anchorIds.length + 1).fill("");
  let slice = 0;
  let cursor = 0;
  for (const event of events) {
    if (event.kind === "anchor") {
      if (cursor >= anchorIds.length || event.id !== anchorIds[cursor]) return [];
      cursor += 1;
      slice = cursor;
    } else if (event.text) {
      slices[slice] = slices[slice] ? `${slices[slice]}\n\n${event.text}` : event.text;
    }
  }
  return slices;
}

/**
 * Split one spine document into anchor-bounded segments, each carrying BOTH
 * projections: the flat `text` (legacy semantics — anchor slicing, whitespace
 * collapse, trim — completely unchanged) and `markdown` (structured projection
 * of the same slice). Anchor ids come from the same document order, so both
 * projections stay slice-aligned; a slice whose markdown would not densely
 * equal its flat text falls back to flat text, keeping the union invariant
 * true for both projections. Images appear only in `markdown`, as `![alt](src)`
 * placeholders whose `src` is resolved against `fileHref` to a package path.
 * Malformed markup falls back to the legacy single-segment `htmlText` flat
 * projection.
 */
export function parseSpineSegments(source: string, fileHref = ""): Segment[] {
  const root = parseSpineRoot(source);
  if (root) annotateFootnotes([{ href: fileHref, root }]);
  return spineSegments(source, root, fileHref).map((segment) =>
    segment.markdown === undefined ? segment : { ...segment, markdown: finalMarkdown(segment.markdown) },
  );
}

/** Parsed spine document root; null when the markup cannot be parsed. */
function parseSpineRoot(source: string): XmlElement | null {
  try {
    return parseXml(source, "text/html").documentElement ?? null;
  } catch {
    return null;
  }
}

function spineSegments(source: string, root: XmlElement | null, fileHref: string): Segment[] {
  try {
    if (!root) return [{ text: htmlText(source) }];
    // `guard` is the flat text minus footnote reference marks, which the
    // Markdown projection renders as `[^label]` instead of their own text.
    const flats: Array<{ anchorId?: string; text: string; guard: string }> = [];
    const anchorIds: string[] = [];
    let parts: string[] = [];
    let guardParts: string[] = [];
    let anchorId: string | undefined = undefined;
    const finish = () => {
      flats.push({ anchorId, text: parts.join("").replace(/\s+/g, " ").trim(), guard: guardParts.join("") });
      parts = [];
      guardParts = [];
    };
    const visit = (node: XmlNode) => {
      const type = node.nodeType;
      if (type === 3 || type === 4) {
        const value = node.nodeValue;
        if (value) {
          parts.push(value);
          guardParts.push(value);
        }
        return;
      }
      if (type !== 1) return;
      const element = node as XmlElement;
      if (noterefLabel(element)) {
        // Flat text keeps the mark verbatim for search and the trigram index.
        parts.push(element.textContent ?? "");
        return;
      }
      const nextAnchor = anchorIdOf(element);
      if (nextAnchor !== undefined) {
        finish();
        anchorId = nextAnchor;
        anchorIds.push(nextAnchor);
      }
      if (isMathElement(element)) {
        // The Markdown projection renders math as LaTeX; search keeps its text.
        parts.push(mathText(element));
        return;
      }
      const children = element.childNodes;
      for (let index = 0; index < children.length; index += 1) visit(children[index]);
    };
    visit(root);
    finish();
    if (!flats.length) return [{ text: "" }];
    const markdowns = markdownSlices(markdownEvents(root), anchorIds);
    const segments: Segment[] = flats.map((flat, index) => {
      const markdown = markdowns.length ? markdowns[index] : undefined;
      return {
        anchorId: flat.anchorId,
        text: flat.text,
        markdown: markdown !== undefined && denseMarkdown(markdown) === dense(flat.guard) ? resolveImageRefs(markdown, fileHref) : flat.text,
      };
    });
    return segments;
  } catch {
    return [{ text: htmlText(source) }];
  }
}

function htmlText(source: string): string {
  return parseXml(source, "text/html")
    .documentElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function elementTag(node: XmlNode): string {
  return ((node as XmlElement).tagName ?? "").toLowerCase();
}

/** Depth inside the toc nav: the nav's direct `<ol>` holds depth-0 entries. */
function navAnchorDepth(anchor: XmlElement, tocNav: XmlElement): number {
  let depth = 0;
  for (let node: XmlNode | null = anchor.parentNode; node && node !== tocNav; node = node.parentNode) {
    if (elementTag(node) === "ol") depth += 1;
  }
  return Math.max(0, depth - 1);
}

/** Depth inside the NCX navMap: top-level navPoints are depth 0. */
function navPointDepth(point: XmlElement): number {
  let depth = 0;
  for (let node: XmlNode | null = point.parentNode; node; node = node.parentNode) {
    if (elementTag(node) === "navpoint") depth += 1;
  }
  return depth;
}

function parseNav(files: Record<string, Uint8Array>, nav: ManifestItem): NavNode[] {
  const root = parseXml(fileText(files, nav.href), "text/html");
  const navs = Array.from(root.getElementsByTagName("nav"));
  const tocNav = navs.find((node) => {
    const kind = node.getAttribute("epub:type") ?? node.getAttribute("type") ?? "";
    return kind.split(/\s+/).includes("toc") || node.getAttribute("role") === "doc-toc";
  }) ?? navs[0];
  if (!tocNav) return [];
  return Array.from(tocNav.getElementsByTagName("a")).flatMap((anchor) => {
    const href = anchor.getAttribute("href");
    const label = anchor.textContent?.replace(/\s+/g, " ").trim();
    return href && label
      ? [{ label, href: resolveHref(nav.href, href), depth: navAnchorDepth(anchor, tocNav) }]
      : [];
  });
}

function parseNcx(files: Record<string, Uint8Array>, ncx: ManifestItem): NavNode[] {
  const root = parseXml(fileText(files, ncx.href));
  return Array.from(root.getElementsByTagName("navPoint")).flatMap((point) => {
    const label = point.getElementsByTagName("text")[0]?.textContent?.trim();
    const href = point.getElementsByTagName("content")[0]?.getAttribute("src");
    return label && href
      ? [{ label, href: resolveHref(ncx.href, href), depth: navPointDepth(point) }]
      : [];
  });
}

function anchorIdOf(element: XmlElement): string | undefined {
  // A footnote reference is never a TOC target; anchoring it would split its paragraph.
  if (noterefLabel(element) || element.getAttribute?.(NOTE_ATTR)) return undefined;
  const id = element.getAttribute("id");
  if (id) return id;
  if (elementTag(element) === "a") {
    const name = element.getAttribute("name");
    if (name) return name;
  }
  return undefined;
}

/**
 * Most a TOC parent's own text may hold (whitespace aside) and still be only
 * its heading, so that it joins its first sub-entry rather than standing as a
 * chapter. Never drops text: a longer lead stays a chapter.
 */
const PARENT_LEAD_MAX_CHARS = 200;

function sameTarget(left: string, right: string): boolean {
  return hrefMatches(left, right) && hrefFragment(left) === hrefFragment(right);
}

function segmentText(segments: readonly Segment[]): string {
  return segments.map((segment) => segment.text).filter(Boolean).join("");
}

function segmentMarkdown(segments: readonly Segment[]): string {
  // Each segment markdown is internally complete; joining distinct segments
  // with `\n\n` keeps headings/quotes on their own lines (a flat `""` join
  // would land a `##` marker mid-line). The flat `texts` join stays ""
  // (union invariant).
  return segments.map((segment) => segment.markdown ?? segment.text).filter(Boolean).join("\n\n");
}

function addFileToBucket(bucket: { hrefs: string[]; texts: string[]; markdowns: string[] }, href: string, text: string, markdown: string): void {
  if (!bucket.hrefs.includes(href)) bucket.hrefs.push(href);
  if (text) bucket.texts.push(text);
  if (markdown) bucket.markdowns.push(markdown);
}

/**
 * Anchor-aware ownership. For every spine file the non-container TOC nodes
 * targeting it (in TOC order) split the file's segments: a node whose
 * `#fragment` resolves to a segment owns that slice, unclaimed slices join the
 * preceding claimer (the file's first node for leading text), and nodes with
 * missing/unresolvable fragments merge into the preceding claimer's bucket (R5)
 * so no text is ever lost. The union of all chapter texts equals the union of
 * all spine texts.
 */
export function buildOwnedChapters(
  nodes: readonly NavNode[],
  spineHrefs: readonly string[],
  spineSegments: readonly Segment[][],
): Chapter[] {
  interface Info { node: NavNode; ancestors: string[]; container: boolean }
  const stack: Array<{ depth: number; label: string }> = [];
  const infos: Info[] = nodes.map((node, index) => {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const ancestors = stack.map((entry) => entry.label);
    stack.push({ depth: node.depth, label: node.label });
    const next = nodes[index + 1];
    const container =
      next !== undefined && next.depth > node.depth && sameTarget(node.href, next.href);
    return { node, ancestors, container };
  });

  interface Bucket { label: string; ancestors: string[]; depth: number; hrefs: string[]; texts: string[]; markdowns: string[] }
  const buckets = new Map<number, Bucket>();
  const bucketFor = (global: number, info: Info): Bucket => {
    let bucket = buckets.get(global);
    if (!bucket) {
      bucket = { label: info.node.label, ancestors: info.ancestors, depth: info.node.depth, hrefs: [], texts: [], markdowns: [] };
      buckets.set(global, bucket);
    }
    return bucket;
  };
  let previous: Bucket | undefined;
  const leadingFiles: Array<{ href: string; text: string; markdown: string }> = [];

  spineHrefs.forEach((fileHref, fileIndex) => {
    const targeting: Array<{ global: number; info: Info }> = [];
    infos.forEach((info, global) => {
      if (!info.container && hrefMatches(info.node.href, fileHref)) targeting.push({ global, info });
    });
    const segments = spineSegments[fileIndex] ?? [];
    if (!targeting.length) {
      const text = segmentText(segments);
      const markdown = segmentMarkdown(segments);
      if (previous) addFileToBucket(previous, fileHref, text, markdown);
      else leadingFiles.push({ href: fileHref, text, markdown });
      return;
    }
    // Resolvable fragment claims; the first node claiming a segment wins.
    const claimOf = new Map<number, number>();
    targeting.forEach(({ info }, local) => {
      const fragment = hrefFragment(info.node.href);
      if (!fragment) return;
      const segmentIndex = segments.findIndex((segment) => segment.anchorId === fragment);
      if (segmentIndex >= 0 && !claimOf.has(segmentIndex)) claimOf.set(segmentIndex, local);
    });
    const owners: number[] = new Array(segments.length).fill(0);
    if (claimOf.size) {
      let current = -1;
      for (let index = 0; index < segments.length; index += 1) {
        const claimed = claimOf.get(index);
        if (claimed !== undefined) current = claimed;
        owners[index] = current >= 0 ? current : 0;
      }
    }
    let lastBucket: Bucket | undefined;
    targeting.forEach(({ info }, local) => {
      const owned: number[] = [];
      segments.forEach((_, index) => {
        if (owners[index] === local) owned.push(index);
      });
      // A node with no owned slice (unresolvable fragment) keeps no chapter; its
      // would-be text already lives in the preceding claimer's bucket (R5).
      if (!owned.length) return;
      const bucket = bucketFor(targeting[local].global, info);
      owned.forEach((index) => {
        const segment = segments[index];
        const href = segment.anchorId === undefined ? fileHref : `${fileHref}#${segment.anchorId}`;
        if (!bucket.hrefs.includes(href)) bucket.hrefs.push(href);
        if (segment.text) bucket.texts.push(segment.text);
        const markdown = segment.markdown ?? segment.text;
        if (markdown) bucket.markdowns.push(markdown);
      });
      lastBucket = bucket;
    });
    if (lastBucket) previous = lastBucket;
  });

  const first = buckets.values().next().value;
  if (first) leadingFiles.forEach(({ href, text, markdown }) => addFileToBucket(first, href, text, markdown));

  const chapters: Chapter[] = [];
  // A parent whose own text is only a heading (a volume title page, the lead
  // before its first sub-entry's anchor) joins its first sub-entry's chapter
  // instead of becoming a chapter of its own.
  const push = (bucket: Bucket): void => {
    const text = bucket.texts.join("");
    if (text) chapters.push({ label: bucket.label, ancestors: bucket.ancestors, depth: bucket.depth, hrefs: bucket.hrefs, text, markdown: bucket.markdowns.join("\n\n") || text });
  };
  let lead: { depth: number; bucket: Bucket } | undefined;
  infos.forEach((info, global) => {
    const own = buckets.get(global);
    if (info.container || !own) return;
    // A parent with no sub-entry chapter after all keeps its own.
    if (lead && info.node.depth <= lead.depth) push(lead.bucket);
    const bucket = lead && info.node.depth > lead.depth
      ? {
          ...own,
          hrefs: [...lead.bucket.hrefs.filter((href) => !own.hrefs.includes(href)), ...own.hrefs],
          texts: [...lead.bucket.texts, ...own.texts],
          markdowns: [...lead.bucket.markdowns, ...own.markdowns],
        }
      : own;
    lead = undefined;
    const next = infos[global + 1];
    const parent = next !== undefined && next.node.depth > info.node.depth;
    if (parent && bucket.texts.join("").replace(/\s+/g, "").length <= PARENT_LEAD_MAX_CHARS) {
      lead = { depth: info.node.depth, bucket };
      return;
    }
    push(bucket);
  });
  if (lead) push(lead.bucket);
  if (chapters.length) return chapters;
  // Empty or entirely unresolvable TOC: one chapter per spine file, as before.
  return spineHrefs.flatMap((href, index) => {
    const segments = spineSegments[index] ?? [];
    const text = segmentText(segments);
    return text ? [{ label: "", ancestors: [] as string[], depth: 0, hrefs: [href], text, markdown: segmentMarkdown(segments) || text }] : [];
  });
}

/** Set on a recognized footnote reference; the value is its `[^label]` label. */
const NOTEREF_ATTR = "data-litera-noteref";
/** Set on a note inside a list or table: its id must not cut segments the Markdown walk cannot cut. */
const NOTE_ATTR = "data-litera-note";
/** Set on a link from a note back to its reference; stripped from definitions. */
const BACKLINK_ATTR = "data-litera-backlink";
const FOOTNOTE_REF = /\[\^[^\]\s]+\]/g;
const FOOTNOTE_LABEL_MAX_CHARS = 12;
const NOTE_BLOCK_TAGS = new Set(["li", "dd", "dt", "td"]);

function noterefLabel(element: XmlElement): string {
  return element.getAttribute?.(NOTEREF_ATTR) ?? "";
}

function withoutFootnoteRefs(text: string): string {
  return text.replace(FOOTNOTE_REF, "");
}

function linkTypes(element: XmlElement): string[] {
  return `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`.split(/\s+/).filter(Boolean);
}

function isBacklinkType(element: XmlElement): boolean {
  return linkTypes(element).some((type) => type === "backlink" || type === "doc-backlink");
}

/**
 * Marker text of a reference written without noteref semantics: `[1]`,
 * `〔注2〕`, `①`, `注3`, `*`, `†`. Parenthesized `(1)` is left out: it is
 * usually an equation or list cross-reference.
 */
const NOTE_MARKER = /^(?:[[［〔【]\s*(?:注|註)?\s*[\p{L}\p{N}]{1,4}\s*[\]］〕】]|[\u2460-\u24ff\u2776-\u2793\u3251-\u325f\u32b1-\u32bf]|(?:注|註)\s*[\p{N}\u2460-\u24ff]{1,4}|\*{1,3}|[†‡§¶])$/u;
/** A class naming the link (or its wrapper or icon) a footnote reference, e.g. Duokan's `duokan-footnote`. */
const NOTE_CLASS = /foot-?note|note-?ref|endnote|fnref|(?:^|[\s_-])(?:fn|note)(?:$|[\s_-]|\d)/i;
/** A plain-link note must be short and must not be a section (headings) or the whole document. */
const NOTE_MAX_CHARS = 4000;

function hasNoteClass(element: XmlElement | null): boolean {
  return !!element && element.nodeType === 1 && NOTE_CLASS.test(element.getAttribute("class") ?? "");
}

/**
 * How a link looks like a footnote reference. `strong`: an `epub:type`/`role`
 * noteref, or a fragment link set as a superscript (`<sup><a>` or
 * `<a><sup>`) — the same shapes the reader styles as note marks. `weak`: a
 * plain fragment link whose text is a note marker or whose class names it a
 * footnote; its target must also look like a note. `null`: not a reference.
 */
function noterefShape(element: XmlElement): "strong" | "weak" | null {
  if (!(element.getAttribute("href") ?? "").includes("#") || isBacklinkType(element)) return null;
  if (linkTypes(element).some((type) => type === "noteref" || type === "doc-noteref")) return "strong";
  if (elementTag(element.parentNode as XmlNode) === "sup") return "strong";
  const children = Array.from(element.childNodes).filter((child) => child.nodeType === 1 || ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()));
  if (children.length === 1 && elementTag(children[0]) === "sup") return "strong";
  if (NOTE_MARKER.test((element.textContent ?? "").replace(/\s+/g, ""))) return "weak";
  const classed = [element, element.parentNode as XmlElement | null, ...children.filter((child): child is XmlElement => child.nodeType === 1)];
  return classed.some(hasNoteClass) ? "weak" : null;
}

/** True when a weak reference's target block reads like a note rather than a section or heading. */
function isNoteLike(note: XmlElement): boolean {
  const tag = elementTag(note);
  if (tag === "body" || tag === "html" || /^h[1-6]$/.test(tag)) return false;
  if (Array.from(note.getElementsByTagName("*")).some((element) => /^h[1-6]$/.test(elementTag(element)))) return false;
  return (note.textContent ?? "").length <= NOTE_MAX_CHARS;
}

function footnoteLabel(text: string, id: string): string {
  const clean = (value: string) => value.replace(/[\s[\]()（）【】〔〕［］〈〉^]/g, "");
  const label = clean(text);
  return label && label.length <= FOOTNOTE_LABEL_MAX_CHARS ? label : clean(id) || "note";
}

/** The note body a reference points at: the target, or its nearest block ancestor when the target is inline. */
function noteBlockOf(target: XmlElement): XmlElement {
  let node: XmlElement | null = target;
  while (node && node.nodeType === 1) {
    if (isMarkdownBlockRoot(node) || NOTE_BLOCK_TAGS.has(elementTag(node))) return node;
    node = node.parentNode as XmlElement | null;
  }
  return target;
}

/**
 * True when an ancestor is a block the Markdown walk consumes whole (list,
 * table, quote, heading, pre): anchors inside it never reach the event stream.
 */
function insideAtomicBlock(element: XmlElement): boolean {
  for (let node = element.parentNode as XmlElement | null; node && node.nodeType === 1; node = node.parentNode as XmlElement | null) {
    if (isMarkdownBlockRoot(node) && !BLOCK_TAGS.has(elementTag(node))) return true;
  }
  return false;
}

/** One-line Markdown of a note body with its backlinks removed. */
function footnoteDefinition(note: XmlElement, noteHref: string): string {
  const clone = note.cloneNode(true) as XmlElement;
  for (const link of Array.from(clone.getElementsByTagName("a"))) {
    if (link.getAttribute(BACKLINK_ATTR)) link.parentNode?.removeChild(link);
  }
  const state: MarkdownWalk = { blocks: [] };
  walkElement(clone, state);
  return finalMarkdown(resolveImageRefs(state.blocks.join(" ").replace(/\s+/g, " ").trim(), noteHref));
}

/**
 * Recognize footnote references across the spine documents: mark each with
 * its label (unique per document) and return the note definitions by
 * referring document and label. A candidate must resolve to an existing
 * element; of a reference/backlink pair pointing at each other, the one
 * earlier in reading order is the reference.
 */
function annotateFootnotes(docs: ReadonlyArray<{ href: string; root: XmlElement }>): Map<string, Map<string, string>> {
  const definitions = new Map<string, Map<string, string>>();
  try {
    const docIndex = new Map(docs.map((doc, index) => [decodedPath(doc.href), index]));
    const idIndexes = new Map<number, Map<string, XmlElement>>();
    const elementById = (index: number, id: string): XmlElement | undefined => {
      let ids = idIndexes.get(index);
      if (!ids) {
        ids = new Map();
        for (const element of Array.from(docs[index].root.getElementsByTagName("*"))) {
          const key = element.getAttribute("id") || (elementTag(element) === "a" ? element.getAttribute("name") : "");
          if (key && !ids.has(key)) ids.set(key, element);
        }
        idIndexes.set(index, ids);
      }
      return ids.get(id);
    };
    const linkTarget = (doc: number, link: XmlElement): { target: XmlElement; targetDoc: number } | undefined => {
      const href = link.getAttribute("href") ?? "";
      const resolved = href.startsWith("#") ? `${docs[doc].href}${href}` : resolveHref(docs[doc].href, href);
      const targetDoc = docIndex.get(decodedPath(stripFragment(resolved)));
      const target = targetDoc === undefined ? undefined : elementById(targetDoc, decodedPath(hrefFragment(resolved)));
      return target && targetDoc !== undefined ? { target, targetDoc } : undefined;
    };
    interface Candidate { element: XmlElement; doc: number; order: number; target: XmlElement; targetDoc: number }
    const candidates: Candidate[] = [];
    const candidateOf = new Map<XmlElement, Candidate>();
    docs.forEach((doc, index) => {
      for (const link of Array.from(doc.root.getElementsByTagName("a"))) {
        if (isBacklinkType(link)) link.setAttribute(BACKLINK_ATTR, "1");
        const shape = noterefShape(link);
        if (!shape) continue;
        const resolved = linkTarget(index, link);
        if (!resolved || (shape === "weak" && !isNoteLike(noteBlockOf(resolved.target)))) continue;
        const candidate = { element: link, doc: index, order: candidates.length, ...resolved };
        candidates.push(candidate);
        candidateOf.set(link, candidate);
      }
    });
    const isBacklink = (candidate: Candidate): boolean =>
      [candidate.target, ...Array.from(candidate.target.getElementsByTagName("a"))].some((element) => {
        const other = candidateOf.get(element);
        return other !== undefined && other.order < candidate.order;
      });
    const refs = candidates.filter((candidate) => {
      if (!isBacklink(candidate)) return true;
      candidate.element.setAttribute(BACKLINK_ATTR, "1");
      return false;
    });
    const labels = new Map<number, { byLabel: Set<string>; byTarget: Map<XmlElement, string> }>();
    const pending: Array<{ element: XmlElement; label: string }> = [];
    const notes = new Set<XmlElement>();
    for (const ref of refs) {
      let docLabels = labels.get(ref.doc);
      if (!docLabels) {
        docLabels = { byLabel: new Set(), byTarget: new Map() };
        labels.set(ref.doc, docLabels);
      }
      let label = docLabels.byTarget.get(ref.target);
      if (!label) {
        const base = footnoteLabel(ref.element.textContent ?? "", hrefFragment(ref.element.getAttribute("href") ?? ""));
        label = base;
        for (let suffix = 2; docLabels.byLabel.has(label); suffix += 1) label = `${base}-${suffix}`;
        docLabels.byLabel.add(label);
        docLabels.byTarget.set(ref.target, label);
        const note = noteBlockOf(ref.target);
        // Any link in the note pointing back at the reference (or its enclosing block) is a backlink.
        const refBlock = noteBlockOf(ref.element);
        for (const link of Array.from(note.getElementsByTagName("a"))) {
          const back = linkTarget(ref.targetDoc, link)?.target;
          for (let node: XmlNode | null = ref.element; back && node; node = node === refBlock ? null : node.parentNode) {
            if (node === back) link.setAttribute(BACKLINK_ATTR, "1");
          }
        }
        const definition = footnoteDefinition(note, docs[ref.targetDoc].href);
        if (definition) {
          const href = docs[ref.doc].href;
          if (!definitions.has(href)) definitions.set(href, new Map());
          definitions.get(href)!.set(label, definition);
        }
      }
      pending.push({ element: ref.element, label });
      if (insideAtomicBlock(ref.target)) notes.add(ref.target);
    }
    // Mark last: a failure above leaves the documents untouched.
    for (const { element, label } of pending) element.setAttribute(NOTEREF_ATTR, label);
    for (const note of notes) note.setAttribute(NOTE_ATTR, "1");
  } catch {
    // Footnotes are an enhancement; on any failure the text reads as before.
    definitions.clear();
  }
  return definitions;
}

/** Attach to each chapter the definitions of the files it draws from; the first file to use a label wins. */
function withFootnotes(chapters: Chapter[], definitions: ReadonlyMap<string, ReadonlyMap<string, string>>): Chapter[] {
  if (!definitions.size) return chapters;
  return chapters.map((chapter) => {
    const footnotes = new Map<string, string>();
    for (const file of new Set(chapter.hrefs.map(stripFragment))) {
      for (const [label, definition] of definitions.get(file) ?? []) {
        if (!footnotes.has(label)) footnotes.set(label, definition);
      }
    }
    return footnotes.size ? { ...chapter, footnotes } : chapter;
  });
}

/** Append `[^label]: definition` lines for the footnote references a read_chapter window contains. */
function withFootnoteDefinitions(window: string, footnotes: ReadonlyMap<string, string> | undefined): string {
  if (!footnotes?.size) return window;
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const [ref] of window.matchAll(FOOTNOTE_REF)) {
    const label = ref.slice(2, -1);
    const definition = footnotes.get(label);
    if (definition === undefined || seen.has(label)) continue;
    seen.add(label);
    lines.push(`[^${label}]: ${definition}`);
  }
  return lines.length ? `${window.trimEnd()}\n\n${lines.join("\n")}` : window;
}

export function parseEpub(buffer: ArrayBuffer): ParsedBook {
  const archive = new Uint8Array(buffer);
  const files = unzipSync(archive);
  const container = parseXml(fileText(files, "META-INF/container.xml"));
  const opfPath = container.getElementsByTagName("rootfile")[0]?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB package document is missing");
  const opf = parseXml(fileText(files, opfPath));
  const manifest = new Map<string, ManifestItem>();
  for (const node of Array.from(opf.getElementsByTagName("item"))) {
    const id = node.getAttribute("id");
    const href = node.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      href: stripFragment(resolveHref(opfPath, href)),
      mediaType: node.getAttribute("media-type") ?? "",
      properties: node.getAttribute("properties") ?? "",
    });
  }
  const spineHrefs = Array.from(opf.getElementsByTagName("itemref")).flatMap((node) => {
    const item = manifest.get(node.getAttribute("idref") ?? "");
    return item ? [item.href] : [];
  });
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"));
  const ncx = [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml");
  const toc = nav ? parseNav(files, nav) : ncx ? parseNcx(files, ncx) : [];
  const sources = spineHrefs.map((href) => fileText(files, href));
  const roots = sources.map(parseSpineRoot);
  const footnotes = annotateFootnotes(spineHrefs.flatMap((href, index) => {
    const root = roots[index];
    return root ? [{ href, root }] : [];
  }));
  const segments = spineHrefs.map((href, index) => spineSegments(sources[index], roots[index], href));
  const chapters = withFootnotes(buildOwnedChapters(toc, spineHrefs, segments), footnotes);
  return {
    metadata: {
      title: firstText(opf, ["dc:title", "title"], "Unknown"),
      author: firstText(opf, ["dc:creator", "creator"], "Unknown"),
      language: firstText(opf, ["dc:language", "language"], "en"),
      totalChapters: chapters.length,
    },
    chapters,
    trigramIndex: buildTrigramIndex(chapters),
    archive,
    images: new Map(
      [...manifest.values()].filter((item) => item.mediaType.startsWith("image/")).map((item) => [item.href, item.mediaType]),
    ),
  };
}

/** Percent-decoded path: hrefs may be encoded where zip entry names are not. */
function decodedPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Inflate one manifest image by its placeholder `src`. */
export function readImageFile(book: ParsedBook, src: string): BookImageFile {
  const wanted = decodedPath(stripFragment(src).replace(/^\/+/, ""));
  const path = [...book.images.keys()].find((key) => decodedPath(key) === wanted);
  if (!path) throw new Error(`No image at ${src} in this book`);
  const names = [path, decodedPath(path)];
  const entries = unzipSync(book.archive, { filter: (file) => names.includes(file.name) });
  const bytes = names.map((name) => entries[name]).find(Boolean);
  if (!bytes) throw new Error(`No image at ${src} in this book`);
  return { src: path, mediaType: book.images.get(path)!, bytes };
}

function buildTrigramIndex(chapters: readonly Chapter[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  chapters.forEach((chapter, chapterIndex) => {
    const seen = new Set<string>();
    for (let offset = 0; offset + 3 <= chapter.text.length; offset += 1) {
      seen.add(chapter.text.slice(offset, offset + 3));
    }
    for (const trigram of seen) {
      const candidates = index.get(trigram);
      if (candidates) candidates.push(chapterIndex);
      else index.set(trigram, [chapterIndex]);
    }
  });
  return index;
}

export function bookToc(book: ParsedBook): BookTocEntry[] {
  return book.chapters.map((chapter, index) => ({
    index,
    label: chapter.label,
    ancestors: chapter.ancestors,
    depth: chapter.depth,
    hrefs: chapter.hrefs,
    chars: chapter.markdown.length,
    parts: chapterParts(chapter).length,
  }));
}

// Cost of cutting a chapter before a block (see `chapterWindows`).
const CUT_BEFORE_SECTION = 0;
const CUT_BEFORE_SUBSECTION = 0.25;
const CUT_AT_PARAGRAPH = 1;
const CUT_AFTER_HEADING = 50;
// Weight of a part's squared relative deviation from the chapter's mean part size.
const PART_IMBALANCE_WEIGHT = 4;
// Cost of one part more than the minimal count.
const EXTRA_PART = 0.75;

const HEADING = /^(#{1,6}) /;
const SCENE_BREAK = /^[*\-_·•◇◆○●※~～＊\s]{3,}$/u;

interface WindowBlock {
  text: string;
  /** Cost of a cut just before this block. */
  cut: number;
}

/**
 * The chapter as packable blocks: its `\n\n` paragraphs, with a block longer
 * than `CHAPTER_PART_CHARS` (e.g. a huge `<pre>`) hard-split into full-size
 * pieces and a residual piece. A full piece fills a window alone, so pieces
 * never join each other and every join of two blocks is an original `\n\n`.
 */
function windowBlocks(markdown: string): WindowBlock[] {
  const blocks: WindowBlock[] = [];
  let afterHeading = false;
  for (const text of markdown.split("\n\n")) {
    if (!text) continue;
    const heading = HEADING.exec(text);
    const cut = afterHeading
      ? CUT_AFTER_HEADING
      : heading
        ? heading[1].length <= 2 ? CUT_BEFORE_SECTION : CUT_BEFORE_SUBSECTION
        : SCENE_BREAK.test(text) ? CUT_BEFORE_SUBSECTION : CUT_AT_PARAGRAPH;
    afterHeading = !!heading;
    if (text.length <= CHAPTER_PART_CHARS) {
      blocks.push({ text, cut });
      continue;
    }
    for (let start = 0; start < text.length; start += CHAPTER_PART_CHARS) {
      blocks.push({ text: text.slice(start, start + CHAPTER_PART_CHARS), cut: start === 0 ? cut : 0 });
    }
  }
  return blocks;
}

/** The fewest windows the blocks pack into, in order (greedy is optimal). */
function minimalWindowCount(blocks: readonly WindowBlock[]): number {
  let count = 0;
  let length = -1;
  for (const block of blocks) {
    if (length >= 0 && length + 2 + block.text.length <= CHAPTER_PART_CHARS) {
      length += 2 + block.text.length;
    } else {
      count += 1;
      length = block.text.length;
    }
  }
  return count;
}

/**
 * The cheapest split of `blocks` into exactly `count` windows of at most
 * `CHAPTER_PART_CHARS`, by dynamic programming over (windows, blocks): the
 * cut costs plus the size imbalance. Returns the window start indices.
 */
function cheapestSplit(blocks: readonly WindowBlock[], count: number): { cost: number; starts: number[] } | null {
  const offsets = [0];
  for (const block of blocks) offsets.push(offsets[offsets.length - 1] + block.text.length + 2);
  const windowLength = (from: number, to: number) => offsets[to] - offsets[from] - 2;
  const target = windowLength(0, blocks.length) / count;
  const n = blocks.length;
  // cost[k][j]: blocks [0, j) in k windows; from[k][j]: where the k-th window starts.
  const cost = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let k = 1; k <= count; k += 1) {
    for (let j = k; j <= n; j += 1) {
      // k windows hold blocks [0, j), and the blocks after j fit in the rest.
      if (windowLength(0, j) > k * (CHAPTER_PART_CHARS + 2) - 2) break;
      if (j < n && windowLength(j, n) > (count - k) * (CHAPTER_PART_CHARS + 2) - 2) continue;
      for (let i = j - 1; i >= k - 1; i -= 1) {
        const length = windowLength(i, j);
        if (length > CHAPTER_PART_CHARS) break;
        if (cost[k - 1][i] === Infinity) continue;
        const deviation = (length - target) / target;
        const value = cost[k - 1][i] + (i > 0 ? blocks[i].cut : 0) + PART_IMBALANCE_WEIGHT * deviation * deviation;
        if (value < cost[k][j]) {
          cost[k][j] = value;
          from[k][j] = i;
        }
      }
    }
  }
  if (cost[count][n] === Infinity) return null;
  const starts: number[] = [];
  for (let k = count, j = n; k > 0; k -= 1) {
    j = from[k][j];
    starts.unshift(j);
  }
  return { cost: cost[count][n], starts };
}

/**
 * Section-aligned window packing: split the markdown on `\n\n` into blocks
 * and cut it into windows of at most `CHAPTER_PART_CHARS` (+2 accounting for
 * the `\n\n` join separator) where a reader would pause. A cut just before a
 * heading or scene break is cheap, one right after a heading is near
 * forbidden, and parts of a chapter should be about the same size; the
 * minimal part count may grow by one when that buys better cuts. Only a
 * single block that alone exceeds the limit is hard-split. Windows joined
 * back with `\n\n` reproduce the original markdown at every block boundary
 * that was NOT introduced by a hard split: the pieces of an oversized block
 * are exact consecutive slices of it (the residual final piece keeps packing
 * with following blocks). Every window is complete Markdown.
 */
export function chapterWindows(markdown: string): string[] {
  const blocks = windowBlocks(markdown);
  if (!blocks.length) return [""];
  const minimal = minimalWindowCount(blocks);
  if (minimal === 1) return [blocks.map((block) => block.text).join("\n\n")];
  const fewest = cheapestSplit(blocks, minimal)!;
  const more = minimal < blocks.length ? cheapestSplit(blocks, minimal + 1) : null;
  const { starts } = more && more.cost + EXTRA_PART < fewest.cost ? more : fewest;
  return starts.map((start, index) =>
    blocks.slice(start, starts[index + 1] ?? blocks.length).map((block) => block.text).join("\n\n"));
}

// The TOC reports part counts on every prompt; pack each chapter once.
const partsCache = new WeakMap<Chapter, string[]>();

/** The read_chapter windows of one chapter, cached per parsed chapter. */
function chapterParts(chapter: Chapter): string[] {
  const cached = partsCache.get(chapter);
  if (cached) return cached;
  let windows: string[];
  try {
    windows = chapterWindows(chapter.markdown);
  } catch {
    // Defensive: if packing ever fails, degrade to flat-text hard slicing.
    windows = Array.from(
      { length: Math.max(1, Math.ceil(chapter.text.length / CHAPTER_PART_CHARS)) },
      (_, part) => chapter.text.slice(part * CHAPTER_PART_CHARS, (part + 1) * CHAPTER_PART_CHARS),
    );
  }
  partsCache.set(chapter, windows);
  return windows;
}

export function readChapter(book: ParsedBook, chapterIndex: number, rawPart = 0) {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) throw new Error("Chapter index is out of range");
  const windows = chapterParts(chapter);
  const totalParts = windows.length;
  const part = Math.min(Math.max(0, Math.trunc(rawPart) || 0), totalParts - 1);
  const chapterTitle = chapterTitleOf(chapter);
  return {
    chapterIndex,
    chapterNumber: chapterIndex + 1,
    ...(chapterTitle ? { chapterTitle } : {}),
    part,
    totalParts,
    text: withFootnoteDefinitions(finalMarkdown(windows[part]), chapter.footnotes),
  };
}

function chapterTitleOf(chapter: Chapter): string | undefined {
  if (chapter.ancestors.length) {
    const path = [...chapter.ancestors, chapter.label].filter(Boolean);
    return path.length ? path.join(" › ") : undefined;
  }
  return chapter.label || undefined;
}

export function searchBook(book: ParsedBook, queries: string[]): SearchHit[] {
  const clean = [...new Set(queries.map((query) => query.trim()).filter(Boolean))].slice(0, 12);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const query of clean) {
    let exact = false;
    book.chapters.forEach((chapter, chapterIndex) => {
      let from = 0;
      for (let count = 0; count < 3; count += 1) {
        const offset = chapter.text.indexOf(query, from);
        if (offset < 0) break;
        exact = true;
        pushHit(hits, seen, chapter, chapterIndex, offset, query.length, "exact");
        from = offset + query.length;
      }
    });
    if (exact) continue;
    const tokens = query.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
    if (tokens.length < 2) continue;
    const required = tokens.length >= 4 ? Math.ceil(tokens.length / 2) : tokens.length;
    const longTokens = tokens.filter((token) => token.length >= 3);
    const shortTokenCount = tokens.length - longTokens.length;
    const candidateIndices = longTokens.length > 0 && shortTokenCount < required
      ? [...new Set(longTokens.flatMap((token) => book.trigramIndex.get(token.slice(0, 3)) ?? []))]
      : book.chapters.map((_, index) => index);
    candidateIndices.forEach((chapterIndex) => {
      const chapter = book.chapters[chapterIndex];
      const present = tokens.filter((token) => chapter.text.includes(token));
      if (present.length < required) return;
      const offset = chapter.text.indexOf(present[0]);
      pushHit(hits, seen, chapter, chapterIndex, offset, present[0].length, "partial");
    });
  }
  return hits.slice(0, 16);
}

function pushHit(
  hits: SearchHit[],
  seen: Set<string>,
  chapter: Chapter,
  chapterIndex: number,
  offset: number,
  matchLength: number,
  match: SearchHit["match"],
) {
  const key = `${chapterIndex}:${Math.floor(offset / 200)}`;
  if (seen.has(key)) return;
  seen.add(key);
  const start = Math.max(0, offset - 160);
  const end = offset + matchLength + 160;
  hits.push({
    chapterIndex,
    chapterTitle: chapterTitleOf(chapter),
    part: partAt(chapter, offset, matchLength),
    match,
    snippet: `${start ? "…" : ""}${chapter.text.slice(start, end)}${end < chapter.text.length ? "…" : ""}`,
  });
}

// Each window's plain text in comparison form, where it ends in the
// chapter's comparison form, and the flat text's comparison-form source map;
// built on the first hit in a chapter.
const partTextCache = new WeakMap<Chapter, { texts: string[]; ends: number[]; flatMap: number[] }>();

function partTexts(chapter: Chapter) {
  const cached = partTextCache.get(chapter);
  if (cached) return cached;
  const texts = chapterParts(chapter).map((window) => normalizeForQuote(plainBlock(window)).text);
  const ends: number[] = [];
  texts.forEach((text, index) => ends.push((ends[index - 1] ?? 0) + text.length));
  const value = { texts, ends, flatMap: texts.length > 1 ? normalizeForQuote(chapter.text).map : [] };
  partTextCache.set(chapter, value);
  return value;
}

/** How many entries of the ascending `map` are below `offset`. */
function countBelow(map: readonly number[], offset: number): number {
  let low = 0;
  let high = map.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (map[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The read_chapter part holding the match at `offset` of the chapter's flat
 * text. Search runs on the flat text while parts are cut from the Markdown,
 * so the offset is first placed by its share of the comparison-form text,
 * then the part is the one nearest that estimate whose text contains the
 * match.
 */
function partAt(chapter: Chapter, offset: number, matchLength: number): number {
  const { texts, ends, flatMap } = partTexts(chapter);
  if (texts.length === 1) return 0;
  const position = (countBelow(flatMap, offset) / (flatMap.length || 1)) * ends[ends.length - 1];
  const estimate = Math.max(0, ends.findIndex((end) => position < end));
  const needle = normalizeForQuote(chapter.text.slice(offset, offset + matchLength)).text;
  if (!needle) return estimate;
  let best = estimate;
  let bestDistance = Infinity;
  texts.forEach((text, part) => {
    const distance = Math.abs(part - estimate);
    if (distance < bestDistance && text.includes(needle)) {
      best = part;
      bestDistance = distance;
    }
  });
  return best;
}

const QUOTE_PASSAGE_MAX_CHARS = 600;
const QUOTE_ELLIPSIS = /…+|\.{3,}|。{3,}/;
const QUOTE_MARKS = /^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》]+$/g;

/** Plain text of one Markdown block: structural line prefixes and emphasis delimiters dropped. */
function plainBlock(markdown: string): string {
  return withoutFootnoteRefs(withoutImages(withoutMarkup(markdown)))
    .split("\n")
    .map((line) => {
      let text = line.replace(/^(\s*)([-+]|\d{1,9}\.)\s+/, "$1");
      text = text.replace(/^(\s*)#{1,6}\s+/, "$1");
      while (/^(\s*)>\s?/.test(text)) text = text.replace(/^(\s*)>\s?/, "$1");
      return text;
    })
    .join("\n")
    .split("**")
    .join("")
    .split("~~")
    .join("")
    .split("*")
    .join("");
}

/**
 * Comparison form for quote matching: whitespace dropped, width-folded
 * (NFKC), curly quotes straightened, case-folded. `map[i]` is the source
 * index of normalized char `i`.
 */
function normalizeForQuote(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) continue;
    const folded = char
      .normalize("NFKC")
      .replace(/[“”„‟«»]/g, '"')
      .replace(/[‘’‚‛]/g, "'")
      .toLowerCase();
    for (const piece of folded) {
      if (/\s/.test(piece)) continue;
      out += piece;
      map.push(index);
    }
  }
  return { text: out, map };
}

/** Normalized quote segments; an ellipsis in the quote marks an omission between segments. */
function quoteSegments(quote: string): string[] {
  return withoutFootnoteRefs(quote)
    // Quotes copied from read_chapter may keep its sup/sub tags and link syntax.
    .replace(/<\/?su[bp]>/gi, "")
    .replace(/\[([^\]]*)\]\((?:https?:|mailto:)[^)\s]*\)/gi, "$1")
    .trim()
    .replace(QUOTE_MARKS, "")
    .split(QUOTE_ELLIPSIS)
    .map((segment) => normalizeForQuote(segment.replace(QUOTE_MARKS, "")).text)
    .filter(Boolean);
}

function matchInBlock(block: string, segments: readonly string[]): { start: number; end: number } | null {
  const normalized = normalizeForQuote(block);
  let from = 0;
  let start = -1;
  let end = -1;
  for (const segment of segments) {
    const at = normalized.text.indexOf(segment, from);
    if (at < 0) return null;
    if (start < 0) start = at;
    end = at + segment.length;
    from = end;
  }
  return { start: normalized.map[start], end: normalized.map[end - 1] + 1 };
}

function locateInChapter(chapter: Chapter, segments: readonly string[]): Pick<QuoteLocation, "passage" | "matchStart" | "matchEnd"> | null {
  for (const block of chapter.markdown.split(/\n{2,}/)) {
    const plain = plainBlock(block).trim();
    const match = matchInBlock(plain, segments);
    if (!match) continue;
    if (plain.length <= QUOTE_PASSAGE_MAX_CHARS) return { passage: plain, matchStart: match.start, matchEnd: match.end };
    const room = Math.max(0, QUOTE_PASSAGE_MAX_CHARS - (match.end - match.start));
    const from = Math.max(0, match.start - Math.floor(room / 2));
    const to = Math.min(plain.length, Math.max(match.end, from + QUOTE_PASSAGE_MAX_CHARS));
    const prefix = from > 0 ? "…" : "";
    return {
      passage: `${prefix}${plain.slice(from, to)}${to < plain.length ? "…" : ""}`,
      matchStart: match.start - from + prefix.length,
      matchEnd: match.end - from + prefix.length,
    };
  }
  return null;
}

/**
 * Find a quoted passage: in the cited chapter first, then anywhere in the
 * Book. Matching ignores whitespace, width, curly-vs-straight quotes and
 * surrounding quote marks; an ellipsis matches any omitted text within one
 * paragraph.
 */
export function locateQuote(book: ParsedBook, chapterIndex: number, quote: string): QuoteLocation {
  const segments = quoteSegments(quote);
  const cited = Number.isInteger(chapterIndex) && chapterIndex >= 0 ? chapterIndex : -1;
  if (segments.join("").length < 2) return { status: "unverified", chapterIndex: cited };
  const order = book.chapters.map((_, index) => index).filter((index) => index !== cited);
  if (book.chapters[cited]) order.unshift(cited);
  for (const index of order) {
    const chapter = book.chapters[index];
    const found = locateInChapter(chapter, segments);
    if (!found) continue;
    const chapterTitle = chapterTitleOf(chapter);
    return {
      status: index === cited ? "verified" : "relocated",
      chapterIndex: index,
      ...(chapterTitle ? { chapterTitle } : {}),
      ...(chapter.hrefs[0] ? { href: chapter.hrefs[0] } : {}),
      ...found,
    };
  }
  return { status: "unverified", chapterIndex: cited };
}
