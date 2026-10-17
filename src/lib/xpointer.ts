/**
 * KOReader (CREngine) XPointers ⇄ DOM positions, for KOReader Sync.
 *
 * KOReader reports an EPUB position as `/body/DocFragment[N]/body/div/p[5]/text().38`:
 * `DocFragment[N]` is the 1-based spine index, element steps are 1-based among
 * same-name siblings (the `[k]` omitted when the name is unique), and a text
 * offset counts code points in CREngine's whitespace-collapsed text.
 *
 * CREngine's DOM is not the browser's: it drops some whitespace-only text
 * nodes, so text steps are only written when they cannot be misnumbered.
 * Element steps match because CREngine's XPointers skip its own boxing nodes.
 */

const XPOINTER_RE = /^\/body(?:\[1\])?\/DocFragment(?:\[(\d+)\])?((?:\/[^/]+)*)$/;
const ELEMENT_STEP_RE = /^([A-Za-z][\w.:-]*)(?:\[(\d+)\])?$/;
const TEXT_STEP_RE = /^text\(\)(?:\[(\d+)\])?(?:\.(\d+))?$/;
const ELEMENT_OFFSET_RE = /\.(\d+)$/;

interface ElementStep {
  name: string;
  index: number;
}

interface ParsedXPointer {
  /** 0-based spine index. */
  sectionIndex: number;
  steps: ElementStep[];
  text: { index: number; offset: number } | null;
}

function bodyOf(doc: Document): Element | null {
  return doc.body ?? doc.getElementsByTagName("body")[0] ?? null;
}

function nameOf(el: Element): string {
  return el.localName.toLowerCase();
}

function sameNameChildren(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((child) => nameOf(child) === name);
}

function textChildren(el: Element): Text[] {
  return Array.from(el.childNodes).filter((node): node is Text => node.nodeType === Node.TEXT_NODE);
}

/** The chapter-start XPointer of a spine section. */
export function sectionXPointer(sectionIndex: number): string {
  return `/body/DocFragment[${sectionIndex + 1}]/body`;
}

export function parseXPointer(xpointer: string): ParsedXPointer | null {
  const match = XPOINTER_RE.exec(xpointer.trim());
  if (!match) return null;
  const fragment = match[1] ? Number(match[1]) : 1;
  if (!Number.isSafeInteger(fragment) || fragment < 1) return null;
  const segments = match[2].split("/").filter(Boolean);
  const steps: ElementStep[] = [];
  let text: ParsedXPointer["text"] = null;
  for (const [i, segment] of segments.entries()) {
    const textStep = TEXT_STEP_RE.exec(segment);
    if (textStep) {
      // A text step is always the last one.
      if (i !== segments.length - 1) return null;
      text = { index: textStep[1] ? Number(textStep[1]) : 1, offset: Number(textStep[2] ?? 0) };
      break;
    }
    // CREngine occasionally writes an offset on an element step; position at the element.
    const step = ELEMENT_STEP_RE.exec(segment.replace(ELEMENT_OFFSET_RE, ""));
    if (!step) return null;
    steps.push({ name: step[1].toLowerCase(), index: step[2] ? Number(step[2]) : 1 });
  }
  // Positions inside the fragment start at its <body>.
  if (steps.length > 0 && steps[0].name === "body") steps.shift();
  return { sectionIndex: fragment - 1, steps, text };
}

/**
 * The XPointer for the start of `range` in spine section `sectionIndex`.
 * Element-level, plus a text step when the element holds a single text node
 * whose leading text CREngine would not collapse differently.
 */
export function xpointerFromRange(range: Range, sectionIndex: number): string {
  let node: Node = range.startContainer;
  let offset = range.startOffset;
  if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[offset]) {
    node = node.childNodes[offset];
    offset = 0;
  }
  const textNode = node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
  const element = textNode ? textNode.parentElement : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
  const doc = element?.ownerDocument;
  const body = doc ? bodyOf(doc) : null;
  const base = sectionXPointer(sectionIndex);
  if (!element || !body || !body.contains(element)) return base;

  const steps: string[] = [];
  for (let el: Element = element; el !== body; el = el.parentElement!) {
    const name = nameOf(el);
    const siblings = el.parentElement ? sameNameChildren(el.parentElement, name) : [el];
    steps.unshift(siblings.length > 1 ? `${name}[${siblings.indexOf(el) + 1}]` : name);
  }
  let path = steps.length ? `${base}/${steps.join("/")}` : base;

  if (textNode && textChildren(element).length === 1) {
    const prefix = textNode.data.slice(0, offset);
    if (!/^\s|\s\s|[\t\n\r]/.test(prefix)) {
      path += `/text().${Array.from(prefix).length}`;
    }
  }
  return path;
}

/** Raw string offset of a code-point offset counted in whitespace-collapsed text. */
function rawOffset(data: string, collapsedOffset: number): number {
  let count = 0;
  let raw = 0;
  let previousSpace = false;
  for (const char of data) {
    const space = /\s/.test(char);
    const collapsed = space && previousSpace;
    if (count >= collapsedOffset && !collapsed) break;
    if (!collapsed) count += 1;
    previousSpace = space;
    raw += char.length;
  }
  return raw;
}

/**
 * Resolve an XPointer against its section document. Steps that do not resolve
 * stop the walk at the deepest element found, so a CREngine/browser DOM
 * mismatch still lands nearby. Null when the XPointer is unreadable or the
 * document has no body.
 */
export function rangeFromXPointer(doc: Document, xpointer: string): Range | null {
  const parsed = parseXPointer(xpointer);
  const body = bodyOf(doc);
  if (!parsed || !body) return null;

  let element = body;
  let exact = true;
  for (const step of parsed.steps) {
    const next = sameNameChildren(element, step.name)[step.index - 1];
    if (!next) {
      exact = false;
      break;
    }
    element = next;
  }

  const range = doc.createRange();
  range.setStart(element, 0);
  if (exact && parsed.text) {
    const texts = textChildren(element).filter((text) => text.data.trim() !== "");
    const text = texts[parsed.text.index - 1];
    if (text) range.setStart(text, Math.min(rawOffset(text.data, parsed.text.offset), text.data.length));
  }
  range.collapse(true);
  return range;
}
