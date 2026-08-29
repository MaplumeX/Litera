import { DOMParser, type Element as XmlElement, type Node as XmlNode } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import {
  CHAPTER_PART_CHARS,
  hrefMatches,
  type BookMetadata,
  type BookTocEntry,
  type SearchHit,
} from "./book-content";

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
}

export interface ParsedBook {
  metadata: BookMetadata;
  chapters: Chapter[];
  trigramIndex: Map<string, number[]>;
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
const BLOCK_TAGS = new Set(["p", "div", "section", "header", "footer", "aside"]);

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
    const text = collapseInline(inlineOf(element));
    if (text) state.blocks.push(text);
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
  const tag = elementTag(element);
  if (INLINE_EMPTY_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  const children = element.childNodes;
  let text = "";
  for (let index = 0; index < children.length; index += 1) text += inlineNode(children[index]);
  if (tag === "em" || tag === "i") return text ? `*${text}*` : text;
  if (tag === "strong" || tag === "b") return text ? `**${text}**` : text;
  if (tag === "del" || tag === "s" || tag === "strike") return text ? `~~${text}~~` : text;
  return text;
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
  return state.blocks.map((block) => block.replace(/\s+$/g, "")).filter(Boolean).join("\n\n");
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
  const lines = markdown.split("\n").map((line) => {
    let text = line.replace(/^(\s*)([-+]|\d{1,9}\.)\s+/, "$1");
    text = text.replace(/^(\s*)#{1,6}\s+/, "$1");
    while (/^(\s*)>\s?/.test(text)) text = text.replace(/^(\s*)>\s?/, "$1");
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
 * true for both projections. Malformed markup falls back to the legacy
 * single-segment `htmlText` flat projection.
 */
export function parseSpineSegments(source: string): Segment[] {
  try {
    const parsed = parseXml(source, "text/html");
    const root = parsed.documentElement;
    if (!root) return [{ text: htmlText(source) }];
    const flats: Array<{ anchorId?: string; text: string }> = [];
    const anchorIds: string[] = [];
    let parts: string[] = [];
    let anchorId: string | undefined = undefined;
    const finish = () => {
      flats.push({ anchorId, text: parts.join("").replace(/\s+/g, " ").trim() });
      parts = [];
    };
    const visit = (node: XmlNode) => {
      const type = node.nodeType;
      if (type === 3 || type === 4) {
        const value = node.nodeValue;
        if (value) parts.push(value);
        return;
      }
      if (type !== 1) return;
      const element = node as XmlElement;
      const nextAnchor = anchorIdOf(element);
      if (nextAnchor !== undefined) {
        finish();
        anchorId = nextAnchor;
        anchorIds.push(nextAnchor);
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
        markdown: markdown !== undefined && denseMarkdown(markdown) === dense(flat.text) ? markdown : flat.text,
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
  const id = element.getAttribute("id");
  if (id) return id;
  if (elementTag(element) === "a") {
    const name = element.getAttribute("name");
    if (name) return name;
  }
  return undefined;
}

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
  infos.forEach((info, global) => {
    const bucket = buckets.get(global);
    if (info.container || !bucket) return;
    const text = bucket.texts.join("");
    if (!text) return;
    chapters.push({ label: bucket.label, ancestors: bucket.ancestors, depth: bucket.depth, hrefs: bucket.hrefs, text, markdown: bucket.markdowns.join("\n\n") || text });
  });
  if (chapters.length) return chapters;
  // Empty or entirely unresolvable TOC: one chapter per spine file, as before.
  return spineHrefs.flatMap((href, index) => {
    const segments = spineSegments[index] ?? [];
    const text = segmentText(segments);
    return text ? [{ label: "", ancestors: [] as string[], depth: 0, hrefs: [href], text, markdown: segmentMarkdown(segments) || text }] : [];
  });
}

export function parseEpub(buffer: ArrayBuffer): ParsedBook {
  const files = unzipSync(new Uint8Array(buffer));
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
  const spineSegments = spineHrefs.map((href) => parseSpineSegments(fileText(files, href)));
  const chapters = buildOwnedChapters(toc, spineHrefs, spineSegments);
  return {
    metadata: {
      title: firstText(opf, ["dc:title", "title"], "Unknown"),
      author: firstText(opf, ["dc:creator", "creator"], "Unknown"),
      language: firstText(opf, ["dc:language", "language"], "en"),
      totalChapters: chapters.length,
    },
    chapters,
    trigramIndex: buildTrigramIndex(chapters),
  };
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
  }));
}

/**
 * Paragraph-aligned window packing (design §7): split the markdown on
 * `\n\n` into blocks, greedily pack blocks into windows of at most
 * `CHAPTER_PART_CHARS` (+2 accounting for the `\n\n` join separator), and
 * hard-split only a single block that alone exceeds the limit. Windows joined
 * back with `\n\n` reproduce the original markdown at every block boundary
 * that was NOT introduced by a hard split: the pieces of an oversized block
 * are exact consecutive slices of it (the residual final piece keeps packing
 * with following blocks). Every window is complete Markdown.
 */
export function chapterWindows(markdown: string): string[] {
  const blocks = markdown.split("\n\n");
  const windows: string[] = [];
  let current = "";
  const seal = () => {
    if (current) windows.push(current);
    current = "";
  };
  for (const block of blocks) {
    if (!block) continue;
    if (block.length > CHAPTER_PART_CHARS) {
      // Oversized single block (e.g. a huge <pre>): hard-split into full-size
      // windows; the residual final piece becomes `current` so following
      // blocks can pack with it instead of wasting a near-empty window.
      seal();
      const fullPieces = Math.floor(block.length / CHAPTER_PART_CHARS);
      for (let piece = 0; piece < fullPieces; piece += 1) {
        windows.push(block.slice(piece * CHAPTER_PART_CHARS, (piece + 1) * CHAPTER_PART_CHARS));
      }
      current = block.slice(fullPieces * CHAPTER_PART_CHARS);
      continue;
    }
    if (!current) {
      current = block;
      continue;
    }
    if (current.length + 2 + block.length <= CHAPTER_PART_CHARS) {
      current = `${current}\n\n${block}`;
    } else {
      windows.push(current);
      current = block;
    }
  }
  seal();
  return windows.length ? windows : [""];
}

export function readChapter(book: ParsedBook, chapterIndex: number, rawPart = 0) {
  const chapter = book.chapters[chapterIndex];
  if (!chapter) throw new Error("Chapter index is out of range");
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
  const totalParts = windows.length;
  const part = Math.min(Math.max(0, Math.trunc(rawPart) || 0), totalParts - 1);
  return {
    chapterIndex,
    chapterNumber: chapterIndex + 1,
    part,
    totalParts,
    text: windows[part],
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
    part: Math.floor(offset / CHAPTER_PART_CHARS),
    match,
    snippet: `${start ? "…" : ""}${chapter.text.slice(start, end)}${end < chapter.text.length ? "…" : ""}`,
  });
}