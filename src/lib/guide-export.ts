import type { GuideDocument } from "@/lib/guide-document";

export interface GuideProseSegment {
  stepIndex: number;
  chapterIndex: number;
  chapterTitle: string;
  label: string;
  /** Markdown explanation with internal `cite:N` links cleaned into readable quotes. */
  markdown: string;
  /** Plain text suitable for continuous TTS playback or plain-text note saving. */
  plainText: string;
}

const CITE_LINK = /\[([^\]]+)\]\(cite:\d+\)/g;
const MD_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const MD_EMPHASIS = /[*_~`]+/g;
const MD_HEADING = /^\s*#{1,6}\s+/gm;
const MD_BULLET = /^\s*[-*+]\s+/gm;

/** Replace Litera's internal `[quote](cite:N)` syntax with clean typographic quotes. */
export function cleanGuideCitations(markdown: string): string {
  return markdown.replace(CITE_LINK, "“$1”");
}

/** Strip Markdown formatting into smooth readable prose (e.g. for Guided TTS or note excerpts). */
export function markdownToPlainProse(markdown: string): string {
  return cleanGuideCitations(markdown)
    .replace(MD_LINK, "$1")
    .replace(MD_HEADING, "")
    .replace(MD_BULLET, "")
    .replace(MD_EMPHASIS, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pure prose stream selector over `GuideDocument`: returns ordered chapter/step
 * prose segments with tool artifacts stripped and side questions separated.
 * Shared contract for Markdown export, Save-to-Note, and future Guided TTS.
 */
export function extractGuideProseSegments(document: GuideDocument): GuideProseSegment[] {
  return document.steps
    .filter((step) => step.explanation.trim().length > 0)
    .map((step) => {
      const markdown = cleanGuideCitations(step.explanation.trim());
      return {
        stepIndex: step.stepIndex,
        chapterIndex: step.chapterIndex,
        chapterTitle: step.chapterTitle,
        label: step.label,
        markdown,
        plainText: markdownToPlainProse(step.explanation),
      };
    });
}

export interface GuideExportOptions {
  bookTitle: string;
  includeSideQuestions?: boolean;
}

/** Format the entire `GuideDocument` into a clean, chapter-grouped Markdown companion document. */
export function formatGuideExportMarkdown(
  document: GuideDocument,
  { bookTitle, includeSideQuestions = true }: GuideExportOptions,
): string {
  const lines: string[] = [];
  const title = bookTitle.trim() || "Guided Reading Notes";
  lines.push(`# ${title}`);
  lines.push("");

  if (includeSideQuestions && document.orphanSideThreads.length > 0) {
    for (const qa of document.orphanSideThreads) {
      if (!qa.answer.trim()) continue;
      lines.push(`> **Q:** ${qa.question.trim()}`);
      lines.push(">");
      lines.push(`> ${cleanGuideCitations(qa.answer.trim()).replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
  }

  for (const run of document.runs) {
    lines.push(`## ${run.chapterTitle}${run.isReread ? " (Re-read)" : ""}`);
    lines.push("");
    for (const step of run.steps) {
      lines.push(`### ${step.label}`);
      lines.push("");
      if (step.explanation.trim()) {
        lines.push(cleanGuideCitations(step.explanation.trim()));
        lines.push("");
      }
      if (includeSideQuestions && step.sideThreads.length > 0) {
        for (const qa of step.sideThreads) {
          if (!qa.answer.trim()) continue;
          lines.push(`> **Q:** ${qa.question.trim()}`);
          lines.push(">");
          lines.push(`> ${cleanGuideCitations(qa.answer.trim()).replace(/\n/g, "\n> ")}`);
          lines.push("");
        }
      }
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

/** Build a safe single-component default filename for `save_text_file`. */
export function defaultGuideExportFileName(bookTitle: string): string {
  const sanitized = bookTitle
    .replace(/[/\\:*?"<>|\0]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return `${sanitized || "litera-guide"}-guide.md`;
}
