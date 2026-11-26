import { chapterForHref, guideParagraphsBefore, isGuideParagraph, type BookTocEntry, type GuideBlock, type GuideBlockImage } from "@/agent/book/book-content";
import { isLegacyGuideStep, type GuidePosition, type GuideStep, type GuideStepOptions, type LegacyGuideStep, type RecordedGuideStep } from "@/types/agent";

/**
 * The default style of a guided step, editable in settings. It asks for
 * complete, in-order coverage and leaves the formatting to the model, as in
 * any answer: every attempt to prescribe the style (narration, then
 * "structure with full sentences") came out too narrative for the reader.
 */
export const DEFAULT_GUIDED_STYLE = `Content:
- Retell and rewrite this part clearly and faithfully in the author's original order, so the reader experiences the book's own argument directly rather than a meta-commentary about it.
- Do not miss substantive information: carry over every argument, premise, turn, rebuttal, concrete example, and substantive footnote/translator note. This overrides "be concise".
- Keep the author's own voice where it matters: quote key definitions, pivotal sentences, sharp phrasing, and striking testimonies verbatim as clickable citation links ([exact text](cite:CHAPTER_INDEX)), using short blockquotes for pivotal lines or vivid testimonies and weaving shorter phrases naturally into the prose.
- Add brief background notes only where a reader would otherwise stumble — a difficult term, historical context, or the scholars/schools the author engages or critiques — keeping clearly separate what the book says and what is your brief note. Avoid lecturer-style signposting or meta-commentary (e.g. announcing foreshadowing or declaring which line is pivotal).
- When the author refers back to earlier material, connect it briefly.
- Stay strictly within this part: if it ends mid-argument, say so; do not preview upcoming sections or list topics the author did not discuss.
- Only if you actually left out secondary material (such as bare bibliographic citations or repetitive testimonies), add one brief note at the end naming it; otherwise add no closing disclaimer.

Form: divide the part into clear, numbered bite-sized sections following each move in the text so the logic is easy to scan and retain. Combine brief, natural paragraphs (2–4 sentences) with structured bullet points using bold lead-ins (and crisp causal chains like A → B when helpful) for definitions, mechanisms, contrasting cases, and examples/footnotes; use formulas ($...$ / $$...$$) and compact tables for arithmetic or comparisons. Keep nesting shallow (at most two levels) so it stays readable rather than turning into a dry skeleton that drops concrete detail.`;

/** Upper bound on a custom guided style, matching a Session's own prompt. */
export const GUIDED_STYLE_MAX_CHARS = 16 * 1024;

/**
 * Appended to the system prompt in Guided sessions. The mechanics are fixed;
 * only `style` (the reader's or the default) varies. Where steps start and end
 * is the `guide_step` tool's business, not the prompt's.
 */
export function guidedPrompt(style: string = DEFAULT_GUIDED_STYLE): string {
  return `<guided_reading>
This is a Guided session. The reader does not read the book themselves; they rely on you to take them through it in the book's order, one guided step at a time, explaining each step in the style below.

guide_step is how the guide moves on: call it whenever you take the reader on through the book. guide_step returns the step's text directly (only call read_chapter if the result lists remaining parts that were not inlined); explain the step in the same reply. Anything else you answer as usual, and the guide stays where it is. Each message comes with the reading state: where the guide is, what the next step would be, and any nearby section breaks.

<style>
${style.trim() || DEFAULT_GUIDED_STYLE}
</style>

Start each step's explanation directly, with no preamble, and do not ask whether to continue; the reader has a Continue button. Write in the reader's language.

When the guide finishes a chapter, a chapter recap of it is added to the conversation. Recaps stay with you for the rest of the book, after earlier explanations slide out of the active window: use them to connect back to earlier chapters, and call search_guide_history if you need a specific detail or reader question from an earlier discussion that a recap leaves out.
</guided_reading>`;
}

export const GUIDED_PROMPT = guidedPrompt();

/** A block of the open Book. */
export interface GuidePoint {
  entry: BookTocEntry;
  block: number;
}

/**
 * A guided step in the open Book: blocks `from` to `to`, inclusive, possibly
 * across chapters. Steps are worked out as spans; `locateGuideStep` finds a
 * recorded step's span and `recordGuideSpan` records one.
 */
export interface GuideSpan {
  from: GuidePoint;
  to: GuidePoint;
}

/** What `locateGuideStep` and `recordGuideSpan` read a chapter's blocks with. */
export type GuideBlocksOf = (chapterIndex: number) => Promise<readonly GuideBlock[]>;

function blockCount(entry: BookTocEntry): number {
  return Math.max(1, entry.blocks);
}

function partStart(entry: BookTocEntry, part: number): number {
  return entry.partStarts[part] ?? 0;
}

function partEnd(entry: BookTocEntry, part: number): number {
  return Math.max(partStart(entry, part), (entry.partStarts[part + 1] ?? blockCount(entry)) - 1);
}

/** The part holding `block`. */
function partOf(entry: BookTocEntry, block: number): number {
  let part = 0;
  while (part + 1 < entry.partStarts.length && entry.partStarts[part + 1] <= block) part += 1;
  return part;
}

function lastPoint(entry: BookTocEntry): GuidePoint {
  return { entry, block: blockCount(entry) - 1 };
}

function compare(left: GuidePoint, right: GuidePoint): number {
  return left.entry.index - right.entry.index || left.block - right.block;
}

function partSpan(entry: BookTocEntry, part: number): GuideSpan {
  return { from: { entry, block: partStart(entry, part) }, to: { entry, block: partEnd(entry, part) } };
}

/**
 * The TOC entry a recorded step or recap meant. Chapter indices shift when the
 * Book's chapters are cut differently than when it was recorded; the recorded
 * title then finds the chapter, when exactly one entry carries it.
 */
export function guideChapterEntry(
  toc: readonly BookTocEntry[],
  chapter: { chapterIndex: number; chapterTitle?: string },
): BookTocEntry | undefined {
  const atIndex = toc.find((entry) => entry.index === chapter.chapterIndex);
  const title = chapter.chapterTitle?.trim();
  if (!title || atIndex?.label.trim() === title) return atIndex;
  const titled = toc.filter((entry) => entry.label.trim() === title);
  return titled.length === 1 ? titled[0] : atIndex;
}

/** Chapters with no text of their own (e.g. a volume heading) are not retold. */
function firstChapterFrom(toc: readonly BookTocEntry[], startIndex: number): BookTocEntry | undefined {
  return toc.find((entry) => entry.index >= startIndex && entry.chars > 0);
}

/** Short front-matter entries skipped by default when starting a guide with no chapter chosen. */
const FRONT_MATTER_LABEL = /^(?:cover|title\s*page|half\s*title|copyright|colophon|table\s+of\s+contents|contents|toc|dedication|epigraph|front\s*matter|封面|版权页?|版权信息|扉页|书名页|半书名页|目录|目\s*录|献词|题献|题记|文前)$/i;
const FRONT_MATTER_MAX_CHARS = 1_200;

/**
 * First body chapter of the Book when starting a fresh guide without a chosen
 * chapter: skips short cover/copyright/TOC front matter, falling back to the
 * first chapter with text if every chapter matches.
 */
export function firstBodyChapter(toc: readonly BookTocEntry[]): BookTocEntry | undefined {
  const nonEmpty = toc.filter((entry) => entry.chars > 0);
  for (const entry of nonEmpty) {
    const label = entry.label.trim();
    if (entry.chars < FRONT_MATTER_MAX_CHARS && FRONT_MATTER_LABEL.test(label)) continue;
    return entry;
  }
  return nonEmpty[0];
}

/**
 * Whether jumping from `prevChapterIndex` to `nextChapterIndex` skips at least
 * one non-empty chapter (or jumps backward past an adjacent chapter).
 */
export function isNonAdjacentChapterJump(
  toc: readonly BookTocEntry[],
  prevChapterIndex: number | null | undefined,
  nextChapterIndex: number,
): boolean {
  if (prevChapterIndex === null || prevChapterIndex === undefined) return false;
  const nonEmpty = toc.filter((entry) => entry.chars > 0).map((entry) => entry.index);
  const prevPos = nonEmpty.indexOf(prevChapterIndex);
  const nextPos = nonEmpty.indexOf(nextChapterIndex);
  if (prevPos < 0 || nextPos < 0) return Math.abs(nextChapterIndex - prevChapterIndex) > 1;
  return Math.abs(nextPos - prevPos) > 1;
}

/**
 * Where `position` is among a chapter's `blocks` now: its recorded block when
 * the snippet still matches there (or it has none), else the nearest block
 * with that snippet, else the recorded block.
 */
export function findGuideBlock(blocks: readonly { snippet: string }[], position: GuidePosition): number {
  const { block, snippet } = position;
  if (!snippet || blocks[block]?.snippet === snippet) return block;
  let found = -1;
  blocks.forEach((candidate, index) => {
    if (candidate.snippet === snippet && (found < 0 || Math.abs(index - block) < Math.abs(found - block))) found = index;
  });
  return found >= 0 ? found : block;
}

/**
 * The blocks of a step from Sessions recorded before steps were block ranges.
 * A step cut for another part count (the chapter was cut differently since)
 * ends before the first part that starts after its share of the chapter, so
 * text may repeat but is never skipped.
 */
function legacySpan(toc: readonly BookTocEntry[], step: LegacyGuideStep): GuideSpan | null {
  const entry = guideChapterEntry(toc, step);
  if (!entry) return null;
  const parts = Math.max(1, entry.parts);
  const scale = step.totalParts > 0 ? parts / step.totalParts : 1;
  const from = partStart(entry, Math.min(parts - 1, Math.floor(step.part * scale)));
  const endPart = step.skim ? parts : Math.floor((step.part + 1) * scale);
  const to = endPart >= parts ? blockCount(entry) - 1 : Math.max(from, partStart(entry, endPart) - 1);
  return { from: { entry, block: from }, to: { entry, block: to } };
}

/** Where `position` is in the open Book: its chapter by title, its block by snippet, clamped to the chapter. */
async function locatePosition(toc: readonly BookTocEntry[], blocksOf: GuideBlocksOf, position: GuidePosition): Promise<GuidePoint | null> {
  const entry = guideChapterEntry(toc, position);
  if (!entry) return null;
  const block = position.snippet ? findGuideBlock(await blocksOf(entry.index), position) : position.block;
  return { entry, block: Math.min(block, blockCount(entry) - 1) };
}

/** The span a recorded step covers in the open Book, or null when it no longer fits. */
export async function locateGuideStep(
  toc: readonly BookTocEntry[],
  blocksOf: GuideBlocksOf,
  step: RecordedGuideStep,
): Promise<GuideSpan | null> {
  if (isLegacyGuideStep(step)) return legacySpan(toc, step);
  const from = await locatePosition(toc, blocksOf, step.from);
  const to = await locatePosition(toc, blocksOf, step.to);
  if (!from || !to || compare(from, to) > 0) return null;
  return { from, to };
}

/** The part a span is, for its label: one whole part of its chapter; null for any other range. */
function wholePart(span: GuideSpan): { index: number; total: number } | null {
  const { entry } = span.from;
  if (span.to.entry.index !== entry.index) return null;
  const index = partOf(entry, span.from.block);
  if (span.from.block !== partStart(entry, index)) return null;
  const end = partEnd(entry, index);
  return span.to.block === end ? { index, total: Math.max(1, entry.parts) } : null;
}

/** `span` as a step to record: its ends with their snippets and the paragraphs the reader sees there. */
export async function recordGuideSpan(blocksOf: GuideBlocksOf, span: GuideSpan): Promise<GuideStep> {
  const position = async ({ entry, block }: GuidePoint, end: "from" | "to"): Promise<GuidePosition> => {
    const blocks = await blocksOf(entry.index);
    const title = entry.label.trim();
    const snippet = blocks[block]?.snippet;
    return {
      chapterIndex: entry.index,
      ...(title ? { chapterTitle: title } : {}),
      block,
      ...(snippet ? { snippet } : {}),
      paragraph: end === "from" ? guideParagraphsBefore(blocks, block) + 1 : guideParagraphsBefore(blocks, block + 1),
    };
  };
  const part = wholePart(span);
  return {
    from: await position(span.from, "from"),
    to: await position(span.to, "to"),
    ...(part ? { part } : {}),
  };
}

/**
 * The Guide cursor: the furthest block the steps reached, or null before the
 * first step. Going back over a chapter does not move it.
 */
export function guideCursor(spans: readonly (GuideSpan | null)[]): GuidePoint | null {
  let cursor: GuidePoint | null = null;
  for (const span of spans) if (span && (!cursor || compare(span.to, cursor) > 0)) cursor = span.to;
  return cursor;
}

/**
 * The step after the Guide cursor: the rest of the part it is in, else the
 * first part of the next chapter with text. Before the first step, the first
 * part of `startIndex`'s chapter (or the next with text). Null at the end of
 * the Book.
 */
export function nextGuideSpan(toc: readonly BookTocEntry[], cursor: GuidePoint | null, startIndex?: number): GuideSpan | null {
  if (!cursor) {
    const start = startIndex !== undefined ? firstChapterFrom(toc, startIndex) : firstBodyChapter(toc);
    return start ? partSpan(start, 0) : null;
  }
  const block = cursor.block + 1;
  if (block < blockCount(cursor.entry)) {
    return { from: { entry: cursor.entry, block }, to: { entry: cursor.entry, block: partEnd(cursor.entry, partOf(cursor.entry, block)) } };
  }
  const next = firstChapterFrom(toc, cursor.entry.index + 1);
  return next ? partSpan(next, 0) : null;
}

/** The first step of the chapter after the one `span` starts in, skipping the rest of it. */
export function skipChapterSpan(toc: readonly BookTocEntry[], span: GuideSpan): GuideSpan | null {
  return nextGuideSpan(toc, lastPoint(span.from.entry));
}

/**
 * The step from where `span` starts to block `to` (inclusive), or null when
 * `to` comes before that start or is not in the Book. The reader picks `to`;
 * the start stays the step's, so the reading leaves no gaps.
 */
export function guideSpanTo(
  toc: readonly BookTocEntry[],
  span: GuideSpan,
  to: { chapterIndex: number; block: number },
): GuideSpan | null {
  const entry = toc.find((candidate) => candidate.index === to.chapterIndex);
  if (!entry || !Number.isInteger(to.block) || to.block < 0 || to.block >= blockCount(entry)) return null;
  const end = { entry, block: to.block };
  if (compare(span.from, end) > 0) return null;
  return { from: span.from, to: end };
}

/** The shortest snippet the Book pane can find a block by. */
const FINDABLE_SNIPPET_CHARS = 4;

/**
 * The first block at or after `start` with enough text to find on the page
 * (not an image, a blank or a one-character heading), or null when the
 * chapter has none from there.
 */
export function findableGuideBlock(blocks: readonly GuideBlock[], start: number): number | null {
  for (let index = Math.max(0, start); index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block.kind && [...block.snippet].length >= FINDABLE_SNIPPET_CHARS) return index;
  }
  return null;
}

/** Blocks the "Read to…" picker loads at a time, at least. */
export const GUIDE_OUTLINE_BLOCKS = 80;

/**
 * What the "Read to…" picker lists: chapters with their blocks from
 * `firstBlock` on, and how many paragraphs come before it.
 */
export interface GuideOutline {
  chapters: Array<{ chapterIndex: number; chapterTitle?: string; firstBlock: number; paragraphsBefore: number; blocks: GuideBlock[] }>;
  /** Pass as `after` to list more; null at the Book's end. */
  more: number | null;
}

/** The chapters the picker lists, and where to go on from (`more`, null at the Book's end). */
export interface GuideOutlinePlan {
  chapters: Array<{ chapterIndex: number; chapterTitle?: string; firstBlock: number }>;
  more: number | null;
}

/**
 * The chapters with text the "Read to…" picker lists for `span`: from its
 * first block, or after chapter `after` when loading more, until at least
 * `blocks` blocks are listed.
 */
export function guideOutlinePlan(
  toc: readonly BookTocEntry[],
  span: GuideSpan,
  after?: number,
  blocks = GUIDE_OUTLINE_BLOCKS,
): GuideOutlinePlan {
  const chapters: GuideOutlinePlan["chapters"] = [];
  let listed = 0;
  let entry = after === undefined ? span.from.entry : firstChapterFrom(toc, after + 1);
  let firstBlock = after === undefined ? span.from.block : 0;
  while (entry && listed < blocks) {
    const title = entry.label.trim();
    chapters.push({ chapterIndex: entry.index, ...(title ? { chapterTitle: title } : {}), firstBlock });
    listed += blockCount(entry) - firstBlock;
    entry = firstChapterFrom(toc, entry.index + 1);
    firstBlock = 0;
  }
  return { chapters, more: entry && chapters.length ? chapters[chapters.length - 1].chapterIndex : null };
}

/** The chapters with text from `from` to `to`, each with the blocks covered. */
function spanChapters(toc: readonly BookTocEntry[], { from, to }: GuideSpan): Array<{ entry: BookTocEntry; first: number; last: number }> {
  return toc
    .filter((entry) => entry.index >= from.entry.index && entry.index <= to.entry.index && entry.chars > 0)
    .map((entry) => ({
      entry,
      first: entry.index === from.entry.index ? from.block : 0,
      last: entry.index === to.entry.index ? to.block : blockCount(entry) - 1,
    }));
}

/** The chapters with text a step covers, in order. */
export function stepChapters(toc: readonly BookTocEntry[], span: GuideSpan | null): number[] {
  return span ? spanChapters(toc, span).map(({ entry }) => entry.index) : [];
}

function chapterName(entry: BookTocEntry): string {
  const title = entry.label.trim();
  return title ? `chapterIndex ${entry.index} ("${title}")` : `chapterIndex ${entry.index}`;
}

/** Maximum read_chapter chunks `guide_step` inlines directly to avoid an extra round-trip. */
export const GUIDE_INLINE_MAX_PARTS = 2;

export interface GuideReadRange {
  chapterIndex: number;
  fromBlock: number;
  toBlock: number;
}

/** The block-range chunks covering a step, cut at part boundaries so no read runs past one part. */
export function spanReadRanges(toc: readonly BookTocEntry[], span: GuideSpan): GuideReadRange[] {
  return spanChapters(toc, span).flatMap(({ entry, first, last }) => {
    const reads: GuideReadRange[] = [];
    for (let part = partOf(entry, first); part <= partOf(entry, last); part += 1) {
      const fromBlock = Math.max(first, partStart(entry, part));
      const toBlock = Math.min(last, partEnd(entry, part));
      reads.push({ chapterIndex: entry.index, fromBlock, toBlock });
    }
    return reads;
  });
}

function formatReadRange(range: GuideReadRange): string {
  return `chapterIndex ${range.chapterIndex}, fromBlock ${range.fromBlock}, toBlock ${range.toBlock}`;
}

/** Where a step reads, for the model. */
function spanWhere(span: GuideSpan): string {
  const { from, to } = span;
  if (from.entry.index !== to.entry.index) return `${chapterName(from.entry)} block ${from.block} through ${chapterName(to.entry)} block ${to.block}`;
  const blocks = `blocks ${from.block} to ${to.block}`;
  const part = wholePart(span);
  if (!part || part.total === 1) return `${chapterName(from.entry)}, ${part && from.block === 0 ? `the whole chapter (${blocks})` : blocks}`;
  return `${chapterName(from.entry)}, part ${part.index} of 0 to ${part.total - 1} (${blocks})`;
}

export interface InlinedStepChunk {
  range: GuideReadRange;
  chapterTitle?: string;
  text: string;
}

/** Substantive images inside `span` (deduplicated by `src`, in reading order). */
export async function collectStepImages(
  toc: readonly BookTocEntry[],
  blocksOf: GuideBlocksOf,
  span: GuideSpan,
): Promise<GuideBlockImage[]> {
  const seen = new Set<string>();
  const images: GuideBlockImage[] = [];
  for (const { entry, first, last } of spanChapters(toc, span)) {
    const blocks = await blocksOf(entry.index);
    for (let index = first; index <= Math.min(last, blocks.length - 1); index += 1) {
      for (const image of blocks[index]?.images ?? []) {
        if (seen.has(image.src)) continue;
        seen.add(image.src);
        images.push(image);
      }
    }
  }
  return images;
}

/**
 * What the model receives from `guide_step`. When `inlined` chunks are given,
 * their text is included directly so the model can explain without a separate
 * `read_chapter` round-trip; any remaining chunks beyond the inline cap are
 * listed for follow-up `read_chapter` calls.
 */
export function guideStepContext(
  toc: readonly BookTocEntry[],
  span: GuideSpan,
  inlined?: readonly InlinedStepChunk[],
  images?: readonly GuideBlockImage[],
  vision = false,
): string {
  const where = spanWhere(span);
  const task = `Guided step: explain ${where}`;
  const ranges = spanReadRanges(toc, span);
  const figureNote = images && images.length > 0
    ? vision
      ? `\n\nFigures in this step (${images.length}): ${images.map((img) => `${img.src}${img.caption || img.alt ? ` ("${img.caption || img.alt}")` : ""}`).join("; ")}. Call view_image for any figure whose visual details matter to your explanation.`
      : `\n\nFigures in this step (${images.length}): ${images.map((img) => `${img.src}${img.caption || img.alt ? ` ("${img.caption || img.alt}")` : ""}`).join("; ")}. You cannot inspect images directly; rely on captions and text without guessing visual details.`
    : "";
  if (!inlined?.length) {
    return `${task} (blocks are a chapter's paragraphs, numbered from 0). Call read_chapter with each of these in the same turn: ${ranges.map(formatReadRange).join("; ")}. Cover exactly this step.${figureNote}`;
  }
  const remaining = ranges.slice(inlined.length);
  const header = remaining.length
    ? `${task}. The first ${inlined.length} part(s) are below; call read_chapter ONLY for the remaining part(s): ${remaining.map(formatReadRange).join("; ")}. Cover exactly this step.${figureNote}`
    : `${task}. The complete text for this step is below — do NOT call read_chapter for it; explain it directly. Cover exactly this step.${figureNote}`;
  const body = inlined.map(({ range, chapterTitle, text }) => {
    const label = chapterTitle
      ? `chapterIndex ${range.chapterIndex} ("${chapterTitle}"), blocks ${range.fromBlock}–${range.toBlock}`
      : `chapterIndex ${range.chapterIndex}, blocks ${range.fromBlock}–${range.toBlock}`;
    return `--- ${label} ---\n${text}`;
  }).join("\n\n");
  return `${header}\n\n${body}`;
}

/** A natural section boundary near the default step end (the block right before a heading). */
export interface NearbySectionBreak {
  toBlock: number;
  nextHeading: string;
}

/**
 * Find heading boundaries near `defaultTo` (within the chapter of `blocks`)
 * so Continue can stop cleanly right before a new section without calling
 * `list_guide_blocks`.
 */
export function nearbySectionBreaks(
  blocks: readonly GuideBlock[],
  defaultFrom: number,
  defaultTo: number,
  limit = 6,
): NearbySectionBreak[] {
  const minHeading = Math.max(defaultFrom + 1, defaultTo - 20);
  const maxHeading = Math.min(blocks.length - 1, defaultTo + 25);
  const candidates: NearbySectionBreak[] = [];
  for (let index = minHeading; index <= maxHeading; index += 1) {
    const block = blocks[index];
    if (!block || block.heading <= 0) continue;
    const toBlock = index - 1;
    if (toBlock < defaultFrom) continue;
    candidates.push({ toBlock, nextHeading: block.snippet });
  }
  if (candidates.length <= limit) return candidates;
  return candidates
    .sort((left, right) => Math.abs(left.toBlock - defaultTo) - Math.abs(right.toBlock - defaultTo))
    .slice(0, limit)
    .sort((left, right) => left.toBlock - right.toBlock);
}

/**
 * Where a Guided session stands, sent with every message in it: the furthest
 * block the guide has reached, the step Continue would take by default, and
 * nearby section breaks around that default end.
 */
export function guideReadingState(
  cursor: GuidePoint | null,
  next: GuideSpan | null,
  breaks: readonly NearbySectionBreak[] = [],
): string {
  const reached = cursor
    ? `The guide has reached ${chapterName(cursor.entry)}, block ${cursor.block} of 0 to ${blockCount(cursor.entry) - 1} (the furthest it has been).`
    : "The guide has not started yet.";
  const ahead = next ? `The default next step: ${spanWhere(next)}.` : "The guide has reached the end of the book.";
  const hints = breaks.length
    ? ` Nearby section breaks (pass as toBlock to stop cleanly before a heading): ${breaks.map((item) => `toBlock ${item.toBlock} (before "${item.nextHeading}")`).join("; ")}.`
    : "";
  return `Guided reading state: ${reached} ${ahead}${hints}`;
}

/** What the model's `guide_step` asks for. */
export interface GuideStepRequest {
  /** Start at this chapter's first block (as a TOC pick does); without it, right after the Guide cursor. */
  chapterIndex?: number;
  /** End in this chapter: at `toBlock`, or at its last block. Defaults to the start's chapter. */
  toChapterIndex?: number;
  toBlock?: number;
}

/**
 * The `guide_step` arguments that take `span` from `cursor`: its chapter when
 * it does not start right after the cursor, its end when it is not the
 * default. Null when no call can take it (it starts mid-chapter, away from
 * the cursor).
 */
export function guideStepRequestFor(toc: readonly BookTocEntry[], cursor: GuidePoint | null, span: GuideSpan): GuideStepRequest | null {
  const request: GuideStepRequest = {};
  let start = nextGuideSpan(toc, cursor);
  if (!start || compare(start.from, span.from) !== 0) {
    if (span.from.block !== 0) return null;
    request.chapterIndex = span.from.entry.index;
    start = nextGuideSpan(toc, null, span.from.entry.index);
    if (!start || compare(start.from, span.from) !== 0) return null;
  }
  const defaultEnd = start.to;
  if (compare(defaultEnd, span.to) !== 0) {
    request.toChapterIndex = span.to.entry.index;
    request.toBlock = span.to.block;
  }
  return request;
}

function guideStepOptionsNote(options?: GuideStepOptions): string {
  if (!options) return "";
  const notes: string[] = [];
  if (options.pace === "compact") {
    notes.push("Explanation pace for this step: compact — stay faithful to every key argument, but tighten phrasing and keep examples brief.");
  } else if (options.pace === "deep") {
    notes.push("Explanation pace for this step: deep — unpack underlying premises, logical transitions, conceptual nuances, and context more thoroughly.");
  }
  const style = options.styleOverride?.trim();
  if (style) {
    notes.push(`Additional style guidance for this step: ${style}`);
  }
  return notes.length ? ` ${notes.join(" ")}` : "";
}

/**
 * What the reader asked for with a message: Continue (no step), leaving the
 * step's end to the model, or a step they picked, plus optional per-step pace/style overrides.
 * Null when the picked step cannot be taken from the cursor.
 */
export function guideRequestContext(
  toc: readonly BookTocEntry[],
  cursor: GuidePoint | null,
  picked?: GuideSpan,
  options?: GuideStepOptions,
): string | null {
  const suffix = guideStepOptionsNote(options);
  if (!picked) {
    return `The reader pressed Continue: take the next guided step with guide_step, without chapterIndex. Leave the end out for the default step, or end it at a natural break near the default end (such as the end of a section), then explain it.${suffix}`;
  }
  const request = guideStepRequestFor(toc, cursor, picked);
  if (!request) return null;
  return `The reader picked the next guided step: ${spanWhere(picked)}. Take it with guide_step ${JSON.stringify(request)}, then explain it.${suffix}`;
}

/**
 * The guided step the model asked for, built as the reader's own picks build
 * it: start right after the Guide cursor or at a chapter's start, end at a
 * block or a chapter's end, or take the default step. An error the model can
 * act on otherwise.
 */
export function requestedGuideSpan(
  toc: readonly BookTocEntry[],
  cursor: GuidePoint | null,
  request: GuideStepRequest,
): { span: GuideSpan } | { error: string } {
  const chapter = (index: number) => toc.find((entry) => entry.index === index);
  if (request.chapterIndex !== undefined && !chapter(request.chapterIndex)) return { error: `No chapter with chapterIndex ${request.chapterIndex}` };
  const start = request.chapterIndex !== undefined ? nextGuideSpan(toc, null, request.chapterIndex) : nextGuideSpan(toc, cursor);
  if (!start) return { error: request.chapterIndex !== undefined ? `No text from chapterIndex ${request.chapterIndex} to the end of the book` : "The guide has reached the end of the book" };
  if (request.toBlock === undefined && request.toChapterIndex === undefined) return { span: start };
  const end = chapter(request.toChapterIndex ?? start.from.entry.index);
  if (!end) return { error: `No chapter with chapterIndex ${request.toChapterIndex}` };
  const toBlock = request.toBlock ?? blockCount(end) - 1;
  if (!Number.isInteger(toBlock) || toBlock < 0 || toBlock >= blockCount(end)) return { error: `chapterIndex ${end.index} has blocks 0 to ${blockCount(end) - 1}; toBlock ${toBlock} is not one of them` };
  const span = guideSpanTo(toc, start, { chapterIndex: end.index, block: toBlock });
  return span
    ? { span }
    : { error: `The step would start at chapterIndex ${start.from.entry.index}, block ${start.from.block}, after the end you asked for (chapterIndex ${end.index}, block ${toBlock}). A step starts right after the guide or at a chapter's first block, never mid-chapter.` };
}

/** How far the guide has got through one chapter, for the TOC. */
export interface GuideChapterProgress {
  /** Blocks covered by guided steps. */
  coveredBlocks: number;
  totalBlocks: number;
  /** The chapter the Guide cursor is in. */
  current: boolean;
}

/**
 * The blocks covered per chapter by `spans` (oldest first; null for steps
 * that no longer fit the Book), and the chapters in the order the steps
 * finished them, each with the index of the step that did.
 */
function chapterCoverage(toc: readonly BookTocEntry[], spans: readonly (GuideSpan | null)[]) {
  const chapters = new Map<number, { blocks: Set<number> }>();
  const finished: Array<{ index: number; step: number }> = [];
  spans.forEach((span, stepIndex) => {
    if (!span) return;
    for (const { entry, first, last } of spanChapters(toc, span)) {
      const chapter = chapters.get(entry.index) ?? { blocks: new Set<number>() };
      for (let block = first; block <= last; block += 1) {
        chapter.blocks.add(block);
      }
      chapters.set(entry.index, chapter);
      if (chapter.blocks.size >= blockCount(entry) && !finished.some(({ index }) => index === entry.index)) {
        finished.push({ index: entry.index, step: stepIndex });
      }
    }
  });
  return { chapters, finished };
}

/**
 * The chapters due for one recap: the first chapter the guided steps (oldest
 * first) finished, every block retold, that has no recap yet,
 * together with the other chapters without a recap that the same step
 * finished. Null when none is due.
 */
export function dueRecap(
  toc: readonly BookTocEntry[],
  spans: readonly (GuideSpan | null)[],
  recapped: ReadonlySet<number>,
): number[] | null {
  const due = chapterCoverage(toc, spans).finished.filter(({ index }) => !recapped.has(index));
  if (!due.length) return null;
  return due.filter(({ step }) => step === due[0].step).map(({ index }) => index);
}

/** A recap's chapters as recorded: one, or a range through `throughChapterIndex`. */
export interface RecapChapters {
  chapterIndex: number;
  chapterTitle?: string;
  throughChapterIndex?: number;
  throughChapterTitle?: string;
}

/** The chapters the recorded recaps cover in the open Book. */
export function recappedChapters(toc: readonly BookTocEntry[], recaps: readonly RecapChapters[]): Set<number> {
  const covered = new Set<number>();
  for (const recap of recaps) {
    const from = guideChapterEntry(toc, recap);
    if (!from) continue;
    const to = recap.throughChapterIndex === undefined
      ? from
      : guideChapterEntry(toc, { chapterIndex: recap.throughChapterIndex, chapterTitle: recap.throughChapterTitle }) ?? from;
    covered.add(from.index);
    for (const entry of toc) {
      if (entry.index > from.index && entry.index <= to.index && entry.chars > 0) covered.add(entry.index);
    }
  }
  return covered;
}

/**
 * Guide progress per TOC href, from the guided steps on the active branch
 * (oldest first). Hrefs whose chapter the guide has not reached are absent.
 */
export function guideTocProgress(
  toc: readonly BookTocEntry[],
  spans: readonly (GuideSpan | null)[],
  hrefs: readonly string[],
): Record<string, GuideChapterProgress> {
  const byChapter = chapterCoverage(toc, spans).chapters;
  const currentIndex = guideCursor(spans)?.entry.index;
  const progress: Record<string, GuideChapterProgress> = {};
  for (const href of hrefs) {
    const entry = chapterForHref(toc, href);
    const chapter = entry && byChapter.get(entry.index);
    if (!entry || !chapter) continue;
    progress[href] = {
      coveredBlocks: chapter.blocks.size,
      totalBlocks: blockCount(entry),
      current: entry.index === currentIndex,
    };
  }
  return progress;
}

/** What the Book pane marks of one chapter: its read blocks, the Guide cursor's block, and which step last covered each block. */
export interface GuidePageMarkChapter {
  chapterIndex: number;
  /** The chapter's files, without fragments. */
  files: string[];
  read: number[];
  cursor?: number;
  /** Block index -> latest step index (in the `spans` array) that covered it. */
  stepByBlock?: Record<number, number>;
}

/**
 * Per chapter the guided steps (oldest first) reached: the blocks read,
 * the block the Guide cursor is on, and the latest step index that covered each block.
 */
export function guidePageMarkPlan(toc: readonly BookTocEntry[], spans: readonly (GuideSpan | null)[]): GuidePageMarkChapter[] {
  const { chapters } = chapterCoverage(toc, spans);
  const stepByChapter = new Map<number, Record<number, number>>();
  spans.forEach((span, stepIndex) => {
    if (!span) return;
    for (const { entry, first, last } of spanChapters(toc, span)) {
      const map = stepByChapter.get(entry.index) ?? {};
      for (let block = first; block <= last; block += 1) map[block] = stepIndex;
      stepByChapter.set(entry.index, map);
    }
  });
  const cursor = guideCursor(spans);
  return toc.flatMap((entry) => {
    const chapter = chapters.get(entry.index);
    if (!chapter) return [];
    const sorted = (blocks: Iterable<number>) => [...blocks].sort((left, right) => left - right);
    const stepByBlock = stepByChapter.get(entry.index);
    return [{
      chapterIndex: entry.index,
      files: [...new Set(entry.hrefs.map((href) => href.split("#")[0]))],
      read: sorted(chapter.blocks),
      ...(cursor?.entry.index === entry.index ? { cursor: cursor.block } : {}),
      ...(stepByBlock && Object.keys(stepByBlock).length > 0 ? { stepByBlock } : {}),
    }];
  });
}

export interface GuideHistoryHit {
  source: "explanation" | "recap" | "question";
  chapterTitle?: string;
  chapterIndex?: number;
  snippet: string;
}

/**
 * Search earlier guided explanations, chapter recaps, and reader side questions
 * on the active branch (used when earlier turns have slid out of model context).
 */
export function searchGuideHistoryRecords(
  records: ReadonlyArray<{ source: "explanation" | "recap" | "question"; chapterTitle?: string; chapterIndex?: number; text: string }>,
  queries: readonly string[],
  limit = 8,
): GuideHistoryHit[] {
  const clean = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
  if (!clean.length) return [];
  const hits: GuideHistoryHit[] = [];
  const seen = new Set<string>();
  for (const query of clean) {
    for (const record of records) {
      const lower = record.text.toLowerCase();
      const offset = lower.indexOf(query);
      if (offset < 0) continue;
      const start = Math.max(0, offset - 120);
      const end = Math.min(record.text.length, offset + query.length + 180);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < record.text.length ? "…" : "";
      const snippet = `${prefix}${record.text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
      const dedupeKey = `${record.source}:${record.chapterIndex ?? ""}:${snippet.slice(0, 60)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      hits.push({
        source: record.source,
        ...(record.chapterIndex !== undefined ? { chapterIndex: record.chapterIndex } : {}),
        ...(record.chapterTitle ? { chapterTitle: record.chapterTitle } : {}),
        snippet,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/** One page of a chapter's blocks for the model's `list_guide_blocks`. */
export interface GuideBlockPage {
  chapterIndex: number;
  chapterTitle?: string;
  totalBlocks: number;
  blocks: Array<{ block: number; paragraph?: number; part: number; chars: number; snippet: string; heading?: number; kind?: "image" | "blank" }>;
  /** Pass as `fromBlock` for the next page; null at the chapter's end. */
  next: number | null;
}

/**
 * Blocks `fromBlock` on of `entry` (at most `size`), numbered as read_chapter
 * and guided steps number them; a paragraph also carries its 1-based number
 * as the reader counts them.
 */
export function guideBlockPage(
  entry: BookTocEntry,
  blocks: readonly GuideBlock[],
  fromBlock = 0,
  size = GUIDE_OUTLINE_BLOCKS,
): GuideBlockPage {
  const start = Math.max(0, Math.floor(fromBlock));
  const end = Math.min(blocks.length, start + size);
  const title = entry.label.trim();
  let paragraph = guideParagraphsBefore(blocks, start);
  return {
    chapterIndex: entry.index,
    ...(title ? { chapterTitle: title } : {}),
    totalBlocks: blocks.length,
    blocks: blocks.slice(start, end).map((block, offset) => ({
      block: start + offset,
      ...(isGuideParagraph(block) ? { paragraph: (paragraph += 1) } : {}),
      part: block.part,
      chars: block.chars,
      snippet: block.snippet,
      ...(block.heading ? { heading: block.heading } : {}),
      ...(block.kind ? { kind: block.kind } : {}),
    })),
    next: end < blocks.length ? end : null,
  };
}
