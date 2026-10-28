/**
 * Marks in the Book pane for a Guided session: the paragraphs the guide has
 * read are faded (more where it only skimmed), and a "read up to here"
 * divider follows the Guide cursor's paragraph.
 * Paragraphs are matched by their opening text, the same on the page and in
 * the chapter's blocks.
 */

/** A Guided session's marks for one file of the Book, as `guideMarkKey`s. */
export interface GuideFileMarks {
  read: string[];
  skimmed: string[];
  cursor?: string;
}

/** Marks per file of the Book (href without fragment). */
export type GuidePageMarks = Record<string, GuideFileMarks>;

const KEY_CHARS = 32;

/** The matching key of a paragraph: its first characters, whitespace dropped. */
export function guideMarkKey(text: string): string {
  return text.replace(/\s+/g, "").slice(0, KEY_CHARS);
}

/** Paragraph-like elements; a div only when no such element is inside it. */
const PARAGRAPHS = "p, li, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, figcaption, div";
const MARK = "data-litera-guide";
const CURSOR = "data-litera-guide-cursor";
/** A marked paragraph's own text color before fading. */
const INK_VAR = "--litera-guide-ink";
const STYLE_ID = "litera-guide-marks";

function isNoteref(element: Element): boolean {
  const tag = element.tagName.toUpperCase();
  if (tag === "SUP" || tag === "RT") return true;
  const type = `${element.getAttribute("epub:type") ?? ""} ${element.getAttribute("role") ?? ""}`;
  return tag === "A" && /noteref/.test(type);
}

/** The key of an element's text, leaving out footnote numbers (the chapter's blocks keep them only as markers). */
function elementKey(element: Element): string {
  let text = "";
  const walk = (node: Node): boolean => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += (child.textContent ?? "").replace(/\s+/g, "");
        if (text.length >= KEY_CHARS) return true;
      } else if (child.nodeType === Node.ELEMENT_NODE && !isNoteref(child as Element)) {
        if (walk(child)) return true;
      }
    }
    return false;
  };
  walk(element);
  return text.slice(0, KEY_CHARS);
}

/** How much of its own color a paragraph keeps once read, and once only skimmed. */
const READ_INK = 62;
const SKIM_INK = 48;

/**
 * Read paragraphs fade from their own color (kept in `INK_VAR`, so a dimmed
 * blockquote stays dimmer than the text around it), skimmed ones more. The
 * Guide cursor's divider is drawn from the unfaded ink, so it stays as clear
 * as on an unread page.
 */
function styles(cursorLabel: string): string {
  const ink = (percent: number) => `color-mix(in srgb, var(${INK_VAR}, currentColor) ${percent}%, transparent)`;
  return `[${MARK}="read"] { color: ${ink(READ_INK)}; }
[${MARK}="skim"] { color: ${ink(SKIM_INK)}; }
[${CURSOR}]::after { content: ${JSON.stringify(cursorLabel)}; display: block; margin: 1.4em 0 1.2em; font-size: 12px; font-style: normal; font-weight: normal; line-height: 1; letter-spacing: 0.12em; text-indent: 0; text-align: center; color: ${ink(45)}; background: linear-gradient(${ink(14)}, ${ink(14)}) left center / calc(50% - 4.5em) 1px no-repeat, linear-gradient(${ink(14)}, ${ink(14)}) right center / calc(50% - 4.5em) 1px no-repeat; }`;
}

/** Keep `element`'s own text color as the ink it fades from. */
function keepInk(element: HTMLElement): void {
  const color = element.ownerDocument.defaultView?.getComputedStyle(element).color;
  if (color) element.style.setProperty(INK_VAR, color);
}

/**
 * Mark the paragraphs of one page document from `marks` (null clears them).
 * Only attributes and one style element change: the text, and so every CFI,
 * stays as it was, and only colors change, so nothing moves.
 */
export function applyGuideMarks(doc: Document, marks: GuideFileMarks | null, cursorLabel: string): void {
  for (const element of doc.querySelectorAll(`[${MARK}], [${CURSOR}]`)) {
    element.removeAttribute(MARK);
    element.removeAttribute(CURSOR);
    (element as HTMLElement).style?.removeProperty(INK_VAR);
    if ((element as HTMLElement).getAttribute("style") === "") element.removeAttribute("style");
  }
  doc.getElementById(STYLE_ID)?.remove();
  if (!marks || !doc.body) return;
  const read = new Set(marks.read);
  const skimmed = new Set(marks.skimmed);
  if (!read.size && !skimmed.size && !marks.cursor) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = styles(cursorLabel);
  (doc.head ?? doc.body).appendChild(style);
  let cursorMarked = false;
  for (const element of doc.body.querySelectorAll(PARAGRAPHS)) {
    if (element.parentElement?.closest(`[${MARK}]`)) continue;
    if (element.tagName.toUpperCase() === "DIV" && element.querySelector(PARAGRAPHS)) continue;
    const key = elementKey(element);
    if (!key) continue;
    const state = read.has(key) ? "read" : skimmed.has(key) ? "skim" : null;
    if (state) {
      keepInk(element as HTMLElement);
      element.setAttribute(MARK, state);
    }
    if (!cursorMarked && key === marks.cursor) {
      element.setAttribute(CURSOR, "");
      cursorMarked = true;
    }
  }
}
