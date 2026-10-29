import { chapterForHref, guideParagraphsBefore, isGuideParagraph, type BookTocEntry, type GuideBlock } from "@/agent/book/book-content";
import type { GuidePosition, GuideStep } from "@/types/agent";

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
 * only `style` (the reader's or the default) varies.
 */
export function guidedPrompt(style: string = DEFAULT_GUIDED_STYLE): string {
  return `<guided_reading>
This is a Guided session. The reader does not read the book themselves; they rely on you to take them through it, one step at a time, in the book's order. Each guided step names exactly what to read: a part of a chapter, or a range of blocks (the chapter's paragraphs) that the reader chose. Read exactly that with read_chapter, then explain it to the reader in the style below.

<style>
${style.trim() || DEFAULT_GUIDED_STYLE}
</style>

A skim step is the exception to completeness: the reader chose to move fast, so give a compressed pass over what it names (the main line and key points) and say at the start that it is a skim.

Start directly, with no preamble, and do not ask whether to continue; the reader has a Continue button. Write in the language of the step label.

Messages without a guided step are the reader's side questions: answer them normally. They do not advance the reading, with one exception: when the reader asks to be guided through a place or a range ("带读第3章", "带读第三章的1-3段", "略读下一章", "读到这一节末尾"), call guide_step instead of retelling it yourself, then reply with one short line saying what comes next. The step is sent after your reply.
- Find the chapter by its title and path in the TOC, not by counting: front matter and sub-sections are chapters of their own, so "第3章" is rarely chapterIndex 2. A chapter cut into sub-sections ends at its last sub-section.
- Find paragraphs and section starts with list_guide_blocks: "the 3rd paragraph" is the block with paragraph 3 (headings, images and blanks have none), as the reader and the step labels count them.
- Leave chapterIndex out to go on from where the guide is.
- A step cannot start mid-chapter. For "第三章的5-7段", offer to read from the start of the chapter, or from where the guide is, to paragraph 7.
- When the place is ambiguous, ask instead of guessing.

When the guide finishes a chapter, a chapter recap of it is added to the conversation. Recaps stay with you for the rest of the book, after the retellings themselves are gone: use them to connect back to earlier chapters.
</guided_reading>`;
}

export const GUIDED_PROMPT = guidedPrompt();

function stepAt(entry: BookTocEntry, part: number): GuideStep {
  return {
    chapterIndex: entry.index,
    part,
    totalParts: Math.max(1, entry.parts),
    ...(entry.label.trim() ? { chapterTitle: entry.label.trim() } : {}),
  };
}

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

function positionAt(entry: BookTocEntry, block: number): GuidePosition {
  return { chapterIndex: entry.index, ...(entry.label.trim() ? { chapterTitle: entry.label.trim() } : {}), block };
}

/**
 * The step covering blocks `fromBlock` of `from` to `toBlock` of `to`: a
 * whole part (or, skimming, a part to the chapter's end) as a plain part
 * step, anything else as a range.
 */
function rangeStep(from: BookTocEntry, fromBlock: number, to: BookTocEntry, toBlock: number, skim?: true): GuideStep {
  const part = partOf(from, fromBlock);
  const step = stepAt(from, part);
  const end = skim ? blockCount(from) - 1 : partEnd(from, part);
  if (from.index === to.index && fromBlock === partStart(from, part) && toBlock === end) return skim ? { ...step, skim } : step;
  return { ...step, ...(skim ? { skim } : {}), range: { from: positionAt(from, fromBlock), to: positionAt(to, toBlock) } };
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
 * The parts of `entry` a part step covered. A step cut for another part
 * count (the Book's parts were cut differently when it was sent) maps onto
 * the same share of the chapter.
 */
function coveredParts(entry: BookTocEntry, step: GuideStep): { first: number; last: number } {
  const parts = Math.max(1, entry.parts);
  const scale = step.totalParts > 0 ? parts / step.totalParts : 1;
  const first = Math.min(parts - 1, Math.floor(step.part * scale));
  const last = step.skim ? parts - 1 : Math.min(parts - 1, Math.ceil((step.part + 1) * scale) - 1);
  return { first, last: Math.max(first, last) };
}

interface Point { entry: BookTocEntry; block: number }

/**
 * The blocks a recorded step covered in the open Book, or null when it no
 * longer fits. Blocks past a chapter's end are clamped to it.
 */
function stepSpan(toc: readonly BookTocEntry[], step: GuideStep): { from: Point; to: Point } | null {
  if (step.range) {
    const fromEntry = guideChapterEntry(toc, step.range.from);
    const toEntry = guideChapterEntry(toc, step.range.to);
    if (!fromEntry || !toEntry) return null;
    const from = { entry: fromEntry, block: Math.min(step.range.from.block, blockCount(fromEntry) - 1) };
    const to = { entry: toEntry, block: Math.min(step.range.to.block, blockCount(toEntry) - 1) };
    return compare(from, to) <= 0 ? { from, to } : null;
  }
  const entry = guideChapterEntry(toc, step);
  if (!entry) return null;
  const { first, last } = coveredParts(entry, step);
  return { from: { entry, block: partStart(entry, first) }, to: { entry, block: partEnd(entry, last) } };
}

function compare(left: Point, right: Point): number {
  return left.entry.index - right.entry.index || left.block - right.block;
}

/** The chapters with text from `from` to `to`, each with the blocks covered. */
function spanChapters(toc: readonly BookTocEntry[], from: Point, to: Point): Array<{ entry: BookTocEntry; first: number; last: number }> {
  return toc
    .filter((entry) => entry.index >= from.entry.index && entry.index <= to.entry.index && entry.chars > 0)
    .map((entry) => ({
      entry,
      first: entry.index === from.entry.index ? from.block : 0,
      last: entry.index === to.entry.index ? to.block : blockCount(entry) - 1,
    }));
}

/**
 * The last block `cursor` reached, -1 when it covered nothing of its chapter
 * any more. Of a part step cut for another part count, the part it ended in,
 * so text may repeat but is never skipped.
 */
function cursorEnd(toc: readonly BookTocEntry[], cursor: GuideStep): Point | null {
  if (cursor.range) return stepSpan(toc, cursor)?.to ?? null;
  const entry = guideChapterEntry(toc, cursor);
  if (!entry) return null;
  const reached = cursor.skim
    ? entry.parts - 1
    : cursor.totalParts === entry.parts
      ? cursor.part
      : Math.floor(((cursor.part + 1) * entry.parts) / cursor.totalParts) - 1;
  return { entry, block: reached >= 0 ? partEnd(entry, reached) : -1 };
}

/**
 * The step after `cursor`: the rest of the part it ended in, else the next
 * part of its chapter, else the first part of the next chapter with text.
 * Before the first step (or when the cursor no longer fits the Book), start
 * at `startIndex` or the first chapter. Null at the end of the Book.
 */
export function nextGuideStep(
  toc: readonly BookTocEntry[],
  cursor: GuideStep | null,
  startIndex?: number,
): GuideStep | null {
  const end = cursor ? cursorEnd(toc, cursor) : null;
  if (!end) {
    const start = firstChapterFrom(toc, startIndex ?? 0);
    return start ? stepAt(start, 0) : null;
  }
  const block = end.block + 1;
  if (block < blockCount(end.entry)) return rangeStep(end.entry, block, end.entry, partEnd(end.entry, partOf(end.entry, block)));
  const next = firstChapterFrom(toc, end.entry.index + 1);
  return next ? stepAt(next, 0) : null;
}

function validBlock(entry: BookTocEntry, block: number): boolean {
  return Number.isInteger(block) && block >= 0 && block < blockCount(entry);
}

/** The step as the open Book defines it, or null when it does not fit. */
export function resolveGuideStep(toc: readonly BookTocEntry[], step: GuideStep): GuideStep | null {
  if (step.range) {
    const from = guideChapterEntry(toc, step.range.from);
    const to = guideChapterEntry(toc, step.range.to);
    if (!from || !to || !validBlock(from, step.range.from.block) || !validBlock(to, step.range.to.block)) return null;
    if (compare({ entry: from, block: step.range.from.block }, { entry: to, block: step.range.to.block }) > 0) return null;
    return rangeStep(from, step.range.from.block, to, step.range.to.block, step.skim);
  }
  const entry = guideChapterEntry(toc, step);
  if (!entry || !Number.isInteger(step.part) || step.part < 0 || step.part >= Math.max(1, entry.parts)) return null;
  const resolved = stepAt(entry, step.part);
  return step.skim ? { ...resolved, skim: true } : resolved;
}

/** `step` as a skim from where it starts to the end of that chapter. */
export function skimGuideStep(toc: readonly BookTocEntry[], step: GuideStep): GuideStep | null {
  const span = stepSpan(toc, step);
  if (!span) return null;
  return rangeStep(span.from.entry, span.from.block, span.from.entry, blockCount(span.from.entry) - 1, true);
}

/** The first step of the chapter after the one `step` starts in, skipping the rest of it. */
export function skipChapterStep(toc: readonly BookTocEntry[], step: GuideStep): GuideStep | null {
  const { range: _range, ...part } = step;
  return nextGuideStep(toc, { ...part, skim: true });
}

/**
 * The paragraph the reader sees at one end of a range (see
 * `GuidePosition.paragraph`) among its chapter's `blocks`.
 */
export function guideRangeParagraph(blocks: readonly GuideBlock[], position: GuidePosition, end: "from" | "to"): number {
  return end === "from" ? guideParagraphsBefore(blocks, position.block) + 1 : guideParagraphsBefore(blocks, position.block + 1);
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
 * The step from where `step` starts to block `to` (inclusive), or null when
 * `to` comes before that start or is not in the Book. The reader picks `to`;
 * the start stays the step's, so the reading leaves no gaps.
 */
export function guideStepTo(
  toc: readonly BookTocEntry[],
  step: GuideStep,
  to: { chapterIndex: number; block: number },
  skim?: boolean,
): GuideStep | null {
  const span = stepSpan(toc, step);
  const entry = toc.find((candidate) => candidate.index === to.chapterIndex);
  if (!span || !entry || !validBlock(entry, to.block)) return null;
  if (compare(span.from, { entry, block: to.block }) > 0) return null;
  return rangeStep(span.from.entry, span.from.block, entry, to.block, skim ? true : undefined);
}

/** The first block `step` covers in the open Book, or null when it does not fit. */
export function guideStepStart(toc: readonly BookTocEntry[], step: GuideStep): { chapterIndex: number; block: number } | null {
  const span = stepSpan(toc, step);
  return span ? { chapterIndex: span.from.entry.index, block: span.from.block } : null;
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
 * The chapters with text the "Read to…" picker lists for `step`: from its
 * first block, or after chapter `after` when loading more, until at least
 * `blocks` blocks are listed.
 */
export function guideOutlinePlan(
  toc: readonly BookTocEntry[],
  step: GuideStep,
  after?: number,
  blocks = GUIDE_OUTLINE_BLOCKS,
): GuideOutlinePlan {
  const span = stepSpan(toc, step);
  if (!span) return { chapters: [], more: null };
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

/** The chapters with text a step covers, in order. */
export function stepChapters(toc: readonly BookTocEntry[], step: GuideStep): number[] {
  const span = stepSpan(toc, step);
  return span ? spanChapters(toc, span.from, span.to).map(({ entry }) => entry.index) : [];
}

function chapterName(chapterIndex: number, chapterTitle?: string): string {
  return chapterTitle ? `chapterIndex ${chapterIndex} ("${chapterTitle}")` : `chapterIndex ${chapterIndex}`;
}

/**
 * The read_chapter calls covering a range: the blocks of each chapter, cut
 * at part ends so no read runs past one part.
 */
function rangeReads(toc: readonly BookTocEntry[], step: GuideStep): string[] {
  const span = stepSpan(toc, step);
  if (!span) return [];
  return spanChapters(toc, span.from, span.to).flatMap(({ entry, first, last }) => {
    const reads: string[] = [];
    for (let part = partOf(entry, first); part <= partOf(entry, last); part += 1) {
      const from = Math.max(first, partStart(entry, part));
      const to = Math.min(last, partEnd(entry, part));
      reads.push(`chapterIndex ${entry.index}, fromBlock ${from}, toBlock ${to}`);
    }
    return reads;
  });
}

/** Model-facing reading context of a guided step. */
export function guideStepContext(toc: readonly BookTocEntry[], step: GuideStep): string {
  if (step.range) {
    const { from, to } = step.range;
    const where = from.chapterIndex === to.chapterIndex
      ? `${chapterName(from.chapterIndex, from.chapterTitle)}, blocks ${from.block} to ${to.block}`
      : `${chapterName(from.chapterIndex, from.chapterTitle)} block ${from.block} through ${chapterName(to.chapterIndex, to.chapterTitle)} block ${to.block}`;
    const task = step.skim
      ? `Guided step (skim): give a compressed pass over ${where}`
      : `Guided step: retell ${where}`;
    return `${task} (blocks are a chapter's paragraphs, numbered from 0). Call read_chapter with each of these in the same turn: ${rangeReads(toc, step).join("; ")}. Cover exactly this range.`;
  }
  const title = step.chapterTitle ? ` ("${step.chapterTitle}")` : "";
  if (step.skim) {
    const parts = Array.from({ length: step.totalParts - step.part }, (_, offset) => step.part + offset);
    return `Guided step (skim): give a compressed pass over chapterIndex ${step.chapterIndex}${title}, parts ${parts.join(", ")} (parts are numbered 0 to ${step.totalParts - 1}). Call read_chapter for each of these parts in the same turn.`;
  }
  return `Guided step: retell chapterIndex ${step.chapterIndex}${title}, part ${step.part} (parts are numbered 0 to ${step.totalParts - 1}). Call read_chapter with chapterIndex ${step.chapterIndex} and part ${step.part}.`;
}

/** How far the guide has got through one chapter, for the TOC. */
export interface GuideChapterProgress {
  /** Blocks covered, by full steps or a skim. */
  coveredBlocks: number;
  totalBlocks: number;
  skimmed: boolean;
  /** The chapter the latest step ended in. */
  current: boolean;
}

/**
 * The blocks covered per chapter by `steps` (oldest first), and the chapters
 * in the order the steps finished them, each with the step that did.
 */
function chapterCoverage(toc: readonly BookTocEntry[], steps: readonly GuideStep[]) {
  // `blocks`: covered at all; `full`: covered by a full (not skim) step.
  const chapters = new Map<number, { blocks: Set<number>; full: Set<number>; skimmed: boolean }>();
  const finished: Array<{ index: number; step: number }> = [];
  steps.forEach((step, stepIndex) => {
    const span = stepSpan(toc, step);
    if (!span) return;
    for (const { entry, first, last } of spanChapters(toc, span.from, span.to)) {
      const chapter = chapters.get(entry.index) ?? { blocks: new Set<number>(), full: new Set<number>(), skimmed: false };
      for (let block = first; block <= last; block += 1) {
        chapter.blocks.add(block);
        if (!step.skim) chapter.full.add(block);
      }
      if (step.skim) chapter.skimmed = true;
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
  steps: readonly GuideStep[],
  recapped: ReadonlySet<number>,
): number[] | null {
  const due = chapterCoverage(toc, steps).finished.filter(({ index }) => !recapped.has(index));
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
  steps: readonly GuideStep[],
  hrefs: readonly string[],
): Record<string, GuideChapterProgress> {
  const byChapter = chapterCoverage(toc, steps).chapters;
  const latest = steps[steps.length - 1];
  const currentIndex = latest && stepSpan(toc, latest)?.to.entry.index;
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
export function guidePageMarkPlan(toc: readonly BookTocEntry[], steps: readonly GuideStep[]): GuidePageMarkChapter[] {
  const { chapters } = chapterCoverage(toc, steps);
  const latest = steps[steps.length - 1];
  const cursor = latest ? stepSpan(toc, latest)?.to : undefined;
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

/** What the model's `guide_step` asks for. */
export interface GuideStepRequest {
  /** Start at this chapter's first block (as a TOC pick does); without it, at the Guide cursor. */
  chapterIndex?: number;
  /** End in this chapter: at `toBlock`, or at its last block. Defaults to the start's chapter. */
  toChapterIndex?: number;
  toBlock?: number;
  skim?: boolean;
}

/**
 * The guided step the model asked for, built as the reader's own picks build
 * it: start at the Guide cursor or at a chapter's start, end at a block or a
 * chapter's end, or take the default step. An error the model can act on otherwise.
 */
export function requestedGuideStep(
  toc: readonly BookTocEntry[],
  cursor: GuideStep | null,
  request: GuideStepRequest,
): { step: GuideStep } | { error: string } {
  const chapter = (index: number) => toc.find((entry) => entry.index === index);
  if (request.chapterIndex !== undefined && !chapter(request.chapterIndex)) return { error: `No chapter with chapterIndex ${request.chapterIndex}` };
  const start = request.chapterIndex !== undefined ? nextGuideStep(toc, null, request.chapterIndex) : nextGuideStep(toc, cursor);
  if (!start) return { error: request.chapterIndex !== undefined ? `No text from chapterIndex ${request.chapterIndex} to the end of the book` : "The guide has reached the end of the book" };
  const from = guideStepStart(toc, start)!;
  if (request.toBlock === undefined && request.toChapterIndex === undefined) {
    const step = request.skim ? skimGuideStep(toc, start) : start;
    return step ? { step } : { error: "The step does not fit the book" };
  }
  const end = chapter(request.toChapterIndex ?? from.chapterIndex);
  if (!end) return { error: `No chapter with chapterIndex ${request.toChapterIndex}` };
  const toBlock = request.toBlock ?? blockCount(end) - 1;
  if (!validBlock(end, toBlock)) return { error: `chapterIndex ${end.index} has blocks 0 to ${blockCount(end) - 1}; toBlock ${toBlock} is not one of them` };
  const step = guideStepTo(toc, start, { chapterIndex: end.index, block: toBlock }, request.skim);
  return step ? { step } : { error: `The step would start at chapterIndex ${from.chapterIndex}, block ${from.block}, after the end you asked for (chapterIndex ${end.index}, block ${toBlock}). A step cannot go back or start mid-chapter.` };
}
