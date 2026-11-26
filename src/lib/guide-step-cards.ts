import { projectGuideDocument } from "@/lib/guide-document";
import type { AgentMessage, RecordedGuideStep } from "@/types/agent";

export interface GuideSideQa {
  question: string;
  answer: string;
}

/**
 * The explanation and follow-up side Q&As for one guided step, index-aligned
 * with `takenGuideSteps(messages)` so Book pane paragraphs (`data-litera-guide-step`)
 * resolve directly to their card.
 */
export interface GuideStepCardData {
  stepIndex: number;
  step: RecordedGuideStep;
  label: string;
  /** Visible message index in the Guided transcript to scroll to on "Open in guide". */
  messageIndex: number;
  explanation: string;
  sideQuestions: GuideSideQa[];
}

/**
 * Extract one card per taken guided step in `messages` (oldest first), along
 * with any reader side questions asked before the next guided step.
 * Derived directly from `projectGuideDocument` so `PageGuideCard` and
 * `GuideWorkspace` always agree on `stepIndex`.
 */
export function extractGuideStepCards(messages: readonly AgentMessage[]): GuideStepCardData[] {
  const doc = projectGuideDocument({
    bookId: "",
    sessionId: null,
    messages,
  });
  return doc.steps.map((step) => ({
    stepIndex: step.stepIndex,
    step: step.step,
    label: step.label,
    messageIndex: step.messageIndex,
    explanation: step.explanation,
    sideQuestions: step.sideThreads
      .filter((qa) => qa.answer.length > 0)
      .map((qa) => ({ question: qa.question, answer: qa.answer })),
  }));
}
