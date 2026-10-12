import type { SearchHit } from "@/agent/book/book-content";
import type { AgentToolCall, AssistantBlock } from "@/types/agent";
import { isSourceToolCall, resultPayload } from "./source-summary";

/**
 * One row of an answer's process timeline. Consecutive `read_chapter` calls
 * on one chapter merge into a single `read` step.
 */
export type ProcessStep =
  | { kind: "thinking"; key: string; text: string }
  | { kind: "narration"; key: string; text: string }
  | { kind: "read"; key: string; calls: AgentToolCall[] }
  | { kind: "tool"; key: string; call: AgentToolCall };

export interface AnswerEntry {
  /** Index in the message's blocks: the stable key and the streaming anchor. */
  index: number;
  block: AssistantBlock;
}

/**
 * An assistant message split into how it got there (the process) and what it
 * delivers (the answer). Thinking and Book tool calls are process; text is
 * narration while a Book tool call still follows it, answer after the last
 * one. Mind maps are always answer. A derived view: nothing is persisted.
 */
export interface AnswerLayout {
  process: ProcessStep[];
  answer: AnswerEntry[];
}

function isSourceBlock(block: AssistantBlock): block is Extract<AssistantBlock, { type: "toolCall" }> {
  return block.type === "toolCall" && isSourceToolCall(block.toolCall);
}

/** The chapter a `read_chapter` call targets: the result's when done, the request's while running. */
export function readStepChapterIndex(call: AgentToolCall): number | undefined {
  const fromResult = readResult(call)?.chapterIndex;
  if (fromResult !== undefined) return fromResult;
  const params = call.params as { chapterIndex?: unknown } | null | undefined;
  return integer(params?.chapterIndex);
}

export function layoutAnswer(blocks: readonly AssistantBlock[]): AnswerLayout {
  let lastSource = -1;
  blocks.forEach((block, index) => {
    if (isSourceBlock(block)) lastSource = index;
  });
  const process: ProcessStep[] = [];
  const answer: AnswerEntry[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "thinking") {
      if (block.text.trim()) process.push({ kind: "thinking", key: `b${index}`, text: block.text });
    } else if (block.type === "text") {
      if (index > lastSource) answer.push({ index, block });
      else if (block.text.trim()) process.push({ kind: "narration", key: `b${index}`, text: block.text });
    } else if (!isSourceToolCall(block.toolCall)) {
      answer.push({ index, block });
    } else if (block.toolCall.tool === "read_chapter") {
      const previous = process[process.length - 1];
      const previousBlock = blocks[index - 1];
      const chapterIndex = readStepChapterIndex(block.toolCall);
      if (
        previous?.kind === "read" &&
        previousBlock !== undefined &&
        isSourceBlock(previousBlock) &&
        chapterIndex !== undefined &&
        readStepChapterIndex(previous.calls[0]) === chapterIndex
      ) {
        previous.calls.push(block.toolCall);
      } else {
        process.push({ kind: "read", key: block.toolCall.toolCallId, calls: [block.toolCall] });
      }
    } else {
      process.push({ kind: "tool", key: block.toolCall.toolCallId, call: block.toolCall });
    }
  });
  return { process, answer };
}

export type LiveActivity = { kind: "thinking" } | { kind: "tool"; call: AgentToolCall };

/**
 * What the assistant is doing right now, for the process row's status line.
 * Null once it is writing the answer (or drawing a mind map), and before
 * anything has streamed.
 */
export function liveActivity(blocks: readonly AssistantBlock[], streaming: boolean): LiveActivity | null {
  if (!streaming || blocks.length === 0) return null;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (isSourceBlock(block) && !block.toolCall.done) return { kind: "tool", call: block.toolCall };
  }
  const last = blocks[blocks.length - 1];
  if (last.type === "thinking" || isSourceBlock(last)) return { kind: "thinking" };
  return null;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export interface ReadResult {
  chapterIndex: number;
  chapterNumber: number;
  title?: string;
  part: number;
  totalParts: number;
  text: string;
}

export function readResult(call: AgentToolCall): ReadResult | undefined {
  if (!call.done || call.isError) return undefined;
  const payload = resultPayload(call.result) as Record<string, unknown> | undefined;
  const chapterIndex = integer(payload?.chapterIndex);
  const part = integer(payload?.part);
  const totalParts = integer(payload?.totalParts);
  if (chapterIndex === undefined || part === undefined || !totalParts) return undefined;
  return {
    chapterIndex,
    chapterNumber: integer(payload?.chapterNumber) ?? chapterIndex + 1,
    ...(typeof payload?.chapterTitle === "string" && payload.chapterTitle ? { title: payload.chapterTitle } : {}),
    part,
    totalParts,
    text: typeof payload?.text === "string" ? payload.text : "",
  };
}

export function searchHits(call: AgentToolCall): SearchHit[] | undefined {
  if (!call.done || call.isError) return undefined;
  const payload = resultPayload(call.result);
  return Array.isArray(payload) ? (payload as SearchHit[]) : undefined;
}

export function annotationCount(call: AgentToolCall): number | undefined {
  if (!call.done || call.isError) return undefined;
  const payload = resultPayload(call.result) as { bookmarks?: unknown; highlights?: unknown } | undefined;
  if (!Array.isArray(payload?.bookmarks) || !Array.isArray(payload?.highlights)) return undefined;
  return payload.bookmarks.length + payload.highlights.length;
}

/** One Markdown line as plain text: block prefixes, emphasis and ellipses dropped. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s?)*/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^(?:[-+]|\d{1,9}\.)\s+/, "")
    .replace(/[*`]|~~/g, "")
    .trim();
}

function plainLines(text: string): string[] {
  return text.split("\n").map(plainLine).filter(Boolean);
}

/** A plain-text preview of a chapter part or snippet, at most `max` characters. */
export function plainExcerpt(text: string, max = 280): string {
  const plain = plainLines(text).join("\n");
  const chars = [...plain];
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : plain;
}

const ANCHOR_MIN_CHARS = 8;

/**
 * A short verbatim stretch of `text` to locate it in the Book with the
 * Citation check: the start of the first substantial line, falling back to
 * the longest line.
 */
export function passageAnchor(text: string, max = 40): string | undefined {
  const lines = plainLines(text)
    .map((line) => line.replace(/^(?:…|\.{3})+|(?:…|\.{3})+$/g, "").trim())
    .filter(Boolean);
  const line =
    lines.find((candidate) => [...candidate].length >= ANCHOR_MIN_CHARS) ??
    lines.reduce<string | undefined>((longest, candidate) => (!longest || candidate.length > longest.length ? candidate : longest), undefined);
  if (!line || [...line].length < 4) return undefined;
  return [...line].slice(0, max).join("").trim();
}
