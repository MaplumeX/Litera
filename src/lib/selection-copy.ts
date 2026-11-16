import type { Element as XmlElement } from "@xmldom/xmldom";
import { isMathElement, mathMarkdown } from "@/lib/mathml";

/** Literal node types: the page lives in an iframe, another realm. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const DOCUMENT_NODES = new Set([9, 11]);

/**
 * Selected text for the clipboard with math written as LaTeX: every `<math>`
 * the range touches becomes `$…$` (or `$$…$$` when the book marks it display
 * math). A formula is taken whole even when only part of it is selected — the
 * rendered glyphs of one are not a usable quote. Everything else is exactly
 * what `range.toString()` yields, so a selection without math copies unchanged.
 *
 * Null when the selection holds no math: the caller then copies as before.
 * Books that rasterize their formulas (an image where the math would be) have
 * nothing to convert and land there too.
 */
export function latexSelectionText(range: Range): string | null {
  let text = "";
  let formulas = 0;

  /** The part of a text node the range really covers. */
  const clip = (node: Text): string => {
    const start = node === range.startContainer ? Math.min(range.startOffset, node.length) : 0;
    const end = node === range.endContainer ? Math.max(start, Math.min(range.endOffset, node.length)) : node.length;
    return node.data.slice(start, end);
  };

  const walk = (node: Node): void => {
    if (node.nodeType === TEXT_NODE) {
      if (range.intersectsNode(node)) text += clip(node as Text);
      return;
    }
    if (node.nodeType === ELEMENT_NODE && !range.intersectsNode(node)) return;
    if (node.nodeType === ELEMENT_NODE && isMathElement(node as unknown as XmlElement)) {
      const element = node as Element;
      // A `<math>` with no readable content keeps its text so nothing vanishes.
      text += mathMarkdown(element as unknown as XmlElement) || (element.textContent ?? "").trim();
      formulas += 1;
      return;
    }
    if (node.nodeType !== ELEMENT_NODE && !DOCUMENT_NODES.has(node.nodeType)) return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };

  // A range inside one text node has that node as its common ancestor, so the
  // walk starts at the document to still see the math around it.
  let root: Node = range.commonAncestorContainer;
  while (root.parentNode) root = root.parentNode;
  walk(root);
  const trimmed = text.trim();
  return formulas && trimmed ? trimmed : null;
}
