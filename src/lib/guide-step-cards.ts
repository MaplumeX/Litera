import { guideStepLabel } from "@/components/chat/GuideBar";
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
  skim: boolean;
  /** Visible message index in the Guided transcript to scroll to on "Open in guide". */
  messageIndex: number;
  explanation: string;
  sideQuestions: GuideSideQa[];
}

/**
 * Extract one card per taken guided step in `messages` (oldest first), along
 * with any reader side questions asked before the next guided step.
 */
export function extractGuideStepCards(messages: readonly AgentMessage[]): GuideStepCardData[] {
  const cards: GuideStepCardData[] = [];
  let current: GuideStepCardData | null = null;
  let pendingQuestion: string | null = null;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "user") {
      if (message.guide) {
        current = {
          stepIndex: cards.length,
          step: message.guide,
          label: message.content || guideStepLabel(message.guide),
          skim: !!message.guide.skim,
          messageIndex: index,
          explanation: "",
          sideQuestions: [],
        };
        cards.push(current);
        pendingQuestion = null;
      } else if (!message.guideRequest && current) {
        pendingQuestion = message.content;
      } else {
        pendingQuestion = null;
      }
      continue;
    }
    if (message.role !== "assistant") continue;
    const toolSteps = (message.blocks ?? []).flatMap((block) =>
      block.type === "toolCall" && block.toolCall.guide ? [block.toolCall.guide] : [],
    );
    if (toolSteps.length > 0) {
      for (const step of toolSteps) {
        current = {
          stepIndex: cards.length,
          step,
          label: guideStepLabel(step),
          skim: !!step.skim,
          messageIndex: index,
          explanation: message.content,
          sideQuestions: [],
        };
        cards.push(current);
      }
      pendingQuestion = null;
    } else if (current) {
      if (pendingQuestion !== null) {
        current.sideQuestions.push({ question: pendingQuestion, answer: message.content });
        pendingQuestion = null;
      } else if (!current.explanation) {
        current.explanation = message.content;
      }
    }
  }
  return cards;
}
