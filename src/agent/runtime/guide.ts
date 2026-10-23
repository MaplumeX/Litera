import { chapterForHref, type BookTocEntry } from "@/agent/book/book-content";
import type { GuideStep } from "@/types/agent";

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
This is a Guided session. The reader does not read the book themselves; they rely on you to take them through it, one part at a time, in the book's order. Each guided step names the exact chapterIndex and part. Read that part with read_chapter, then explain it to the reader in the style below.

<style>
${style.trim() || DEFAULT_GUIDED_STYLE}
</style>

A skim step is the exception to completeness: the reader chose to move fast, so give a compressed pass over the parts it names (the main line and key points) and say at the start that it is a skim.

Start directly, with no preamble, and do not ask whether to continue; the reader has a Continue button. Write in the language of the step label.

Messages without a guided step are the reader's side questions: answer them normally. They do not advance the reading.
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

/** Chapters with no text of their own (e.g. a volume heading) are not retold. */
function firstChapterFrom(toc: readonly BookTocEntry[], startIndex: number): BookTocEntry | undefined {
  return toc.find((entry) => entry.index >= startIndex && entry.chars > 0);
}

/**
 * The step after `cursor`: the next part of its chapter, else the first part
 * of the next chapter with text (a skim covers the rest of its chapter).
 * Before the first step (or when the cursor no longer fits the Book), start
 * at `startIndex` or the first chapter. Null at the end of the Book.
 */
export function nextGuideStep(
  toc: readonly BookTocEntry[],
  cursor: GuideStep | null,
  startIndex?: number,
): GuideStep | null {
  const current = cursor ? toc.find((entry) => entry.index === cursor.chapterIndex) : undefined;
  if (!cursor || !current) {
    const start = firstChapterFrom(toc, startIndex ?? 0);
    return start ? stepAt(start, 0) : null;
  }
  const reached = cursor.skim ? current.parts - 1 : cursor.part;
  if (reached + 1 < current.parts) return stepAt(current, reached + 1);
  const next = firstChapterFrom(toc, current.index + 1);
  return next ? stepAt(next, 0) : null;
}

/** The step as the open Book defines it, or null when it does not fit. */
export function resolveGuideStep(toc: readonly BookTocEntry[], step: GuideStep): GuideStep | null {
  const entry = toc.find((candidate) => candidate.index === step.chapterIndex);
  if (!entry || !Number.isInteger(step.part) || step.part < 0 || step.part >= Math.max(1, entry.parts)) return null;
  const resolved = stepAt(entry, step.part);
  return step.skim ? { ...resolved, skim: true } : resolved;
}

/** The first step of the chapter after `step`'s, skipping the rest of it. */
export function skipChapterStep(toc: readonly BookTocEntry[], step: GuideStep): GuideStep | null {
  return nextGuideStep(toc, { ...step, skim: true });
}

/** Model-facing reading context of a guided step. */
export function guideStepContext(step: GuideStep): string {
  const title = step.chapterTitle ? ` ("${step.chapterTitle}")` : "";
  if (step.skim) {
    const parts = Array.from({ length: step.totalParts - step.part }, (_, offset) => step.part + offset);
    return `Guided step (skim): give a compressed pass over chapterIndex ${step.chapterIndex}${title}, parts ${parts.join(", ")} (parts are numbered 0 to ${step.totalParts - 1}). Call read_chapter for each of these parts in the same turn.`;
  }
  return `Guided step: retell chapterIndex ${step.chapterIndex}${title}, part ${step.part} (parts are numbered 0 to ${step.totalParts - 1}). Call read_chapter with chapterIndex ${step.chapterIndex} and part ${step.part}.`;
}

/** How far the guide has got through one chapter, for the TOC. */
export interface GuideChapterProgress {
  /** Parts covered, by full steps or a skim. */
  covered: number;
  totalParts: number;
  skimmed: boolean;
  /** The chapter of the latest step. */
  current: boolean;
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
  const byChapter = new Map<number, { parts: Set<number>; skimmed: boolean }>();
  for (const step of steps) {
    const entry = toc.find((candidate) => candidate.index === step.chapterIndex);
    if (!entry) continue;
    const chapter = byChapter.get(entry.index) ?? { parts: new Set<number>(), skimmed: false };
    const last = step.skim ? entry.parts - 1 : step.part;
    for (let part = step.part; part <= last && part < entry.parts; part += 1) chapter.parts.add(part);
    if (step.skim) chapter.skimmed = true;
    byChapter.set(entry.index, chapter);
  }
  const currentIndex = steps[steps.length - 1]?.chapterIndex;
  const progress: Record<string, GuideChapterProgress> = {};
  for (const href of hrefs) {
    const entry = chapterForHref(toc, href);
    const chapter = entry && byChapter.get(entry.index);
    if (!entry || !chapter) continue;
    progress[href] = {
      covered: chapter.parts.size,
      totalParts: Math.max(1, entry.parts),
      skimmed: chapter.skimmed,
      current: entry.index === currentIndex,
    };
  }
  return progress;
}
