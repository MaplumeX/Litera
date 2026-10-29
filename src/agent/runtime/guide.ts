import { chapterForHref, guideParagraphsBefore, isGuideParagraph, type BookTocEntry, type GuideBlock } from "@/agent/book/book-content";
import { isLegacyGuideStep, type GuidePosition, type GuideStep, type LegacyGuideStep, type RecordedGuideStep } from "@/types/agent";

/**
 * The default style of a guided step, editable in settings. It asks for
 * complete, in-order coverage and leaves the formatting to the model, as in
 * any answer: every attempt to prescribe the style (narration, then
 * "structure with full sentences") came out too narrative for the reader.
 */
export const DEFAULT_GUIDED_STYLE = `Content:
- Cover the part completely and in the original order: every argument, example, piece of evidence, turn and rebuttal. The reader should miss nothing the author says; drop only true filler such as repetition. This overrides "be concise".
- Explain where the reader needs it: background, a difficult term, an easy misreading. Keep clear what the author says and what is your explanation.
- Quote the author's key sentences as citation links.
- When the author refers back to earlier material, connect it to what you covered before.
- Stay within this part. If it ends mid-argument, say so.
- If you left anything out (long footnotes, a repeated example), name it at the end. Never drop content silently.

Form: organize it however makes it clearest and fastest to take in, as you would any well-formatted answer. Use headings, lists, tables, bold and blockquotes freely; prefer them to long paragraphs.`;

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

guide_step is how the guide moves on: call it whenever you take the reader on through the book, then read the step it gives you and explain it in the same reply. Anything else you answer as usual, and the guide stays where it is. Each message comes with the reading state: where the guide is and what the next step would be.

<style>
${style.trim() || DEFAULT_GUIDED_STYLE}
</style>

A skim step is the exception to completeness: the reader chose to move fast, so give a compressed pass over what it names (the main line and key points) and say at the start that it is a skim.

Start each step's explanation directly, with no preamble, and do not ask whether to continue; the reader has a Continue button. Write in the reader's language.

When the guide finishes a chapter, a chapter recap of it is added to the conversation. Recaps stay with you for the rest of the book, after the explanations themselves are gone: use them to connect back to earlier chapters.
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
  skim?: true;
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
  return { from: { entry, block: from }, to: { entry, block: to }, ...(step.skim ? { skim: true as const } : {}) };
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
  return { from, to, ...(step.skim ? { skim: true as const } : {}) };
}

/** The part a span is, for its label: one whole part of its chapter (a skim: that part to the chapter's end). */
function wholePart(span: GuideSpan): { index: number; total: number } | null {
  const { entry } = span.from;
  if (span.to.entry.index !== entry.index) return null;
  const index = partOf(entry, span.from.block);
  if (span.from.block !== partStart(entry, index)) return null;
  const end = span.skim ? blockCount(entry) - 1 : partEnd(entry, index);
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
    ...(span.skim ? { skim: true as const } : {}),
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
    const start = firstChapterFrom(toc, startIndex ?? 0);
    return start ? partSpan(start, 0) : null;
  }
  const block = cursor.block + 1;
  if (block < blockCount(cursor.entry)) {
    return { from: { entry: cursor.entry, block }, to: { entry: cursor.entry, block: partEnd(cursor.entry, partOf(cursor.entry, block)) } };
  }
  const next = firstChapterFrom(toc, cursor.entry.index + 1);
  return next ? partSpan(next, 0) : null;
}

/** `span` as a skim from where it starts to the end of that chapter. */
export function skimGuideSpan(span: GuideSpan): GuideSpan {
  return { from: span.from, to: lastPoint(span.from.entry), skim: true };
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
  skim?: boolean,
): GuideSpan | null {
  const entry = toc.find((candidate) => candidate.index === to.chapterIndex);
  if (!entry || !Number.isInteger(to.block) || to.block < 0 || to.block >= blockCount(entry)) return null;
  const end = { entry, block: to.block };
  if (compare(span.from, end) > 0) return null;
  return { from: span.from, to: end, ...(skim ? { skim: true as const } : {}) };
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

/** The read_chapter calls covering a step: the blocks of each chapter, cut at part ends so no read runs past one part. */
function spanReads(toc: readonly BookTocEntry[], span: GuideSpan): string[] {
  return spanChapters(toc, span).flatMap(({ entry, first, last }) => {
    const reads: string[] = [];
    for (let part = partOf(entry, first); part <= partOf(entry, last); part += 1) {
      const from = Math.max(first, partStart(entry, part));
      const to = Math.min(last, partEnd(entry, part));
      reads.push(`chapterIndex ${entry.index}, fromBlock ${from}, toBlock ${to}`);
    }
    return reads;
  });
}

/** Where a step reads, for the model. */
function spanWhere(span: GuideSpan): string {
  const { from, to } = span;
  if (from.entry.index !== to.entry.index) return `${chapterName(from.entry)} block ${from.block} through ${chapterName(to.entry)} block ${to.block}`;
  const blocks = `blocks ${from.block} to ${to.block}`;
  const part = wholePart(span);
  if (!part || part.total === 1) return `${chapterName(from.entry)}, ${part && from.block === 0 ? `the whole chapter (${blocks})` : blocks}`;
  return span.skim
    ? `${chapterName(from.entry)}, parts ${part.index} to ${part.total - 1} of 0 to ${part.total - 1} (${blocks})`
    : `${chapterName(from.entry)}, part ${part.index} of 0 to ${part.total - 1} (${blocks})`;
}

/** What the model reads for a guided step it took: `guide_step`'s result. */
export function guideStepContext(toc: readonly BookTocEntry[], span: GuideSpan): string {
  const where = spanWhere(span);
  const task = span.skim ? `Guided step (skim): give a compressed pass over ${where}` : `Guided step: explain ${where}`;
  return `${task} (blocks are a chapter's paragraphs, numbered from 0). Call read_chapter with each of these in the same turn: ${spanReads(toc, span).join("; ")}. Cover exactly this step.`;
}

/**
 * Where a Guided session stands, sent with every message in it: the furthest
 * block the guide has reached and the step Continue would take by default.
 */
export function guideReadingState(cursor: GuidePoint | null, next: GuideSpan | null): string {
  const reached = cursor
    ? `The guide has reached ${chapterName(cursor.entry)}, block ${cursor.block} of 0 to ${blockCount(cursor.entry) - 1} (the furthest it has been).`
    : "The guide has not started yet.";
  const ahead = next ? `The default next step: ${spanWhere(next)}.` : "The guide has reached the end of the book.";
  return `Guided reading state: ${reached} ${ahead}`;
}

/** What the model's `guide_step` asks for. */
export interface GuideStepRequest {
  /** Start at this chapter's first block (as a TOC pick does); without it, right after the Guide cursor. */
  chapterIndex?: number;
  /** End in this chapter: at `toBlock`, or at its last block. Defaults to the start's chapter. */
  toChapterIndex?: number;
  toBlock?: number;
  skim?: boolean;
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
  if (span.skim) request.skim = true;
  const defaultEnd = span.skim ? skimGuideSpan(start).to : start.to;
  if (compare(defaultEnd, span.to) !== 0) {
    request.toChapterIndex = span.to.entry.index;
    request.toBlock = span.to.block;
  }
  return request;
}

/**
 * What the reader asked for with a message: Continue (no step), leaving the
 * step's end to the model, or a step they picked. Null when the picked step
 * cannot be taken from the cursor.
 */
export function guideRequestContext(toc: readonly BookTocEntry[], cursor: GuidePoint | null, picked?: GuideSpan): string | null {
  if (!picked) {
    return "The reader pressed Continue: take the next guided step with guide_step, without chapterIndex. Leave the end out for the default step, or end it at a natural break near the default end (such as the end of a section), then explain it.";
  }
  const request = guideStepRequestFor(toc, cursor, picked);
  if (!request) return null;
  return `The reader picked the next guided step: ${spanWhere(picked)}${picked.skim ? ", as a skim" : ""}. Take it with guide_step ${JSON.stringify(request)}, then explain it.`;
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
  if (request.toBlock === undefined && request.toChapterIndex === undefined) return { span: request.skim ? skimGuideSpan(start) : start };
  const end = chapter(request.toChapterIndex ?? start.from.entry.index);
  if (!end) return { error: `No chapter with chapterIndex ${request.toChapterIndex}` };
  const toBlock = request.toBlock ?? blockCount(end) - 1;
  if (!Number.isInteger(toBlock) || toBlock < 0 || toBlock >= blockCount(end)) return { error: `chapterIndex ${end.index} has blocks 0 to ${blockCount(end) - 1}; toBlock ${toBlock} is not one of them` };
  const span = guideSpanTo(toc, start, { chapterIndex: end.index, block: toBlock }, request.skim);
  return span
    ? { span }
    : { error: `The step would start at chapterIndex ${start.from.entry.index}, block ${start.from.block}, after the end you asked for (chapterIndex ${end.index}, block ${toBlock}). A step starts right after the guide or at a chapter's first block, never mid-chapter.` };
}

/** How far the guide has got through one chapter, for the TOC. */
export interface GuideChapterProgress {
  /** Blocks covered, by full steps or a skim. */
  coveredBlocks: number;
  totalBlocks: number;
  skimmed: boolean;
  /** The chapter the Guide cursor is in. */
  current: boolean;
}

/**
 * The blocks covered per chapter by `spans` (oldest first; null for steps
 * that no longer fit the Book), and the chapters in the order the steps
 * finished them, each with the index of the step that did.
 */
function chapterCoverage(toc: readonly BookTocEntry[], spans: readonly (GuideSpan | null)[]) {
  // `blocks`: covered at all; `full`: covered by a full (not skim) step.
  const chapters = new Map<number, { blocks: Set<number>; full: Set<number>; skimmed: boolean }>();
  const finished: Array<{ index: number; step: number }> = [];
  spans.forEach((span, stepIndex) => {
    if (!span) return;
    for (const { entry, first, last } of spanChapters(toc, span)) {
      const chapter = chapters.get(entry.index) ?? { blocks: new Set<number>(), full: new Set<number>(), skimmed: false };
      for (let block = first; block <= last; block += 1) {
        chapter.blocks.add(block);
        if (!span.skim) chapter.full.add(block);
      }
      if (span.skim) chapter.skimmed = true;
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
 * first) finished, every block retold or skimmed, that has no recap yet,
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
      skimmed: chapter.skimmed,
      current: entry.index === currentIndex,
    };
  }
  return progress;
}

/** What the Book pane marks of one chapter: its blocks read in full or only skimmed, and the Guide cursor's block. */
export interface GuidePageMarkChapter {
  chapterIndex: number;
  /** The chapter's files, without fragments. */
  files: string[];
  read: number[];
  skimmed: number[];
  cursor?: number;
}

/**
 * Per chapter the guided steps (oldest first) reached: the blocks read in
 * full, those only skimmed, and the block the Guide cursor is on.
 */
export function guidePageMarkPlan(toc: readonly BookTocEntry[], spans: readonly (GuideSpan | null)[]): GuidePageMarkChapter[] {
  const { chapters } = chapterCoverage(toc, spans);
  const cursor = guideCursor(spans);
  return toc.flatMap((entry) => {
    const chapter = chapters.get(entry.index);
    if (!chapter) return [];
    const sorted = (blocks: Iterable<number>) => [...blocks].sort((left, right) => left - right);
    return [{
      chapterIndex: entry.index,
      files: [...new Set(entry.hrefs.map((href) => href.split("#")[0]))],
      read: sorted(chapter.full),
      skimmed: sorted([...chapter.blocks].filter((block) => !chapter.full.has(block))),
      ...(cursor?.entry.index === entry.index ? { cursor: cursor.block } : {}),
    }];
  });
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
