/**
 * Validation for the `draw_mindmap` tool.
 *
 * The mind map is a derived view of the tool call's persisted parameters, so
 * these limits are enforced before the lightweight receipt is returned: an
 * over-limit outline must surface as a structured tool error (`isError`) so
 * the model retries with a smaller, valid outline instead of drawing
 * something broken.
 */
export const MINDMAP_MAX_DEPTH = 4;
export const MINDMAP_MAX_NODES = 100;
export const MINDMAP_MAX_LINE = 200;

/** Lightweight receipt returned to the model; never echoes the outline. */
export interface MindmapReceipt {
  status: "drawn";
  title: string;
  nodes: number;
}

const HEADING_PATTERN = /^(#{1,6})\s+\S/;
const LIST_PATTERN = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+\S/;

interface OutlineLine {
  /** 1-based line number in the outline. */
  number: number;
  text: string;
}

/** Split an outline into content lines, skipping fenced code blocks. */
function outlineLines(outline: string): OutlineLine[] {
  const lines: OutlineLine[] = [];
  let fenced = false;
  for (const [index, raw] of outline.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && raw.trim().length > 0) lines.push({ number: index + 1, text: raw });
  }
  return lines;
}

export interface MindmapOutlineStats {
  nodes: number;
  maxDepth: number;
}

/**
 * Count outline nodes (markdown headings and list items, mirroring what
 * markmap renders) and measure the deepest nesting level.
 *
 * Heading depth is the heading level; a list item sits one level under the
 * nearest heading (or the outline root when no heading precedes it) plus its
 * own indentation (two spaces per level).
 */
export function mindmapOutlineStats(outline: string): MindmapOutlineStats {
  let nodes = 0;
  let maxDepth = 0;
  let headingLevel = 0;
  for (const { text } of outlineLines(outline)) {
    const heading = HEADING_PATTERN.exec(text);
    if (heading) {
      headingLevel = heading[1].length;
      nodes += 1;
      maxDepth = Math.max(maxDepth, headingLevel);
      continue;
    }
    const list = LIST_PATTERN.exec(text);
    if (list) {
      nodes += 1;
      const indentLevels = Math.floor(list[1].length / 2);
      maxDepth = Math.max(maxDepth, headingLevel + indentLevels + 1);
    }
  }
  return { nodes, maxDepth };
}

/**
 * Validate `draw_mindmap` parameters. Returns the receipt on success; throws
 * an Error whose message tells the model which limit was exceeded so it can
 * retry with a smaller outline.
 */
export function validateMindmapParams(title: string, outline: string): MindmapReceipt {
  if (typeof title !== "string" || typeof outline !== "string") {
    throw new Error("draw_mindmap requires string parameters: title and outline");
  }
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("Mind map title must not be empty");
  if (cleanTitle.length > MINDMAP_MAX_LINE) {
    throw new Error(`Mind map title exceeds ${MINDMAP_MAX_LINE} characters; shorten the title`);
  }
  for (const { number, text } of outlineLines(outline)) {
    if (text.length > MINDMAP_MAX_LINE) {
      throw new Error(
        `Mind map outline line ${number} is ${text.length} characters, exceeding the limit of ${MINDMAP_MAX_LINE}; shorten or split the line`,
      );
    }
  }
  const stats = mindmapOutlineStats(outline);
  if (stats.nodes < 1) {
    throw new Error(
      "Mind map outline is empty; provide a markdown outline of headings and/or nested list items",
    );
  }
  if (stats.nodes > MINDMAP_MAX_NODES) {
    throw new Error(
      `Mind map outline has ${stats.nodes} nodes, exceeding the limit of ${MINDMAP_MAX_NODES}; reduce the outline`,
    );
  }
  if (stats.maxDepth > MINDMAP_MAX_DEPTH) {
    throw new Error(
      `Mind map outline reaches depth ${stats.maxDepth}, exceeding the limit of ${MINDMAP_MAX_DEPTH} levels; flatten the outline`,
    );
  }
  return { status: "drawn", title: cleanTitle, nodes: stats.nodes };
}
