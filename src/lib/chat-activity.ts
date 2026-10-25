import { isTranscriptMarker, type AgentMessage } from "@/types/agent";

/**
 * What a conversation is doing, for a host that shows it while the
 * conversation itself is out of sight (the phone's peek bar).
 */
export interface ChatActivity {
  answering: boolean;
  /** The latest answer's opening as one line of plain text; empty before any text. */
  preview: string;
  /** The latest answer ended in an error. */
  failed: boolean;
}

const PREVIEW_LENGTH = 80;

/** One line of plain text from the start of an answer's Markdown. */
export function answerPreview(markdown: string, maxLength = PREVIEW_LENGTH): string {
  const plain = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // Links and Citations keep their text.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function chatActivity(messages: AgentMessage[], answering: boolean): ChatActivity {
  let last: AgentMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isTranscriptMarker(messages[i])) { last = messages[i]; break; }
  }
  if (last?.role !== "assistant") return { answering, preview: "", failed: false };
  return { answering, preview: answerPreview(last.content), failed: last.stopReason === "error" };
}
