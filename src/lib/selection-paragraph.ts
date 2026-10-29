/** Elements that hold one paragraph of a page. */
const PARAGRAPH_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "DD", "DT", "TD", "TH", "FIGCAPTION", "CAPTION"]);
/** Longer text is no paragraph but a whole wrapper; leave it out. */
const PARAGRAPH_MAX_CHARS = 4_000;

/** The last text node the range really covers, not one it merely touches at its end. */
function lastCoveredNode(range: Range): Node {
  if (range.endOffset > 0 || range.collapsed) return range.endContainer;
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node !== range.endContainer && range.intersectsNode(node) && node.textContent?.trim()) last = node;
  }
  return last ?? range.endContainer;
}

/**
 * The text of the page paragraph a selection ends in, whitespace collapsed:
 * the nearest paragraph-like element around its end, else the nearest div.
 * Empty when there is none or it is too long to be one paragraph.
 */
export function selectionParagraph(range: Range): string {
  const node = lastCoveredNode(range);
  let element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  let div: Element | null = null;
  let paragraph: Element | null = null;
  for (; element && element.tagName.toUpperCase() !== "BODY"; element = element.parentElement) {
    const tag = element.tagName.toUpperCase();
    if (PARAGRAPH_TAGS.has(tag)) {
      paragraph = element;
      break;
    }
    if (!div && tag === "DIV") div = element;
  }
  const text = ((paragraph ?? div)?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > PARAGRAPH_MAX_CHARS ? "" : text;
}
