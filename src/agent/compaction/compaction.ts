import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { PiSessionEntry } from "@/agent/sessions/pi-session";

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  previousSummary?: string;
  tokensBefore: number;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
}

// ============================================================================
// Token estimation
// ============================================================================

/** Total context tokens from usage, preferring the native totalTokens field. */
export function calculateContextTokens(usage: { totalTokens: number; input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

const ESTIMATED_IMAGE_CHARS = 4800;

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let chars = 0;
  for (const block of content) {
    const part = block as { type?: string; text?: string; data?: string };
    if (part?.type === "text" && typeof part.text === "string") chars += part.text.length;
    else if (part?.type === "image") chars += ESTIMATED_IMAGE_CHARS;
  }
  return chars;
}

/**
 * Estimate token count for a message using a chars/4 heuristic.
 * Conservative (overestimates tokens).
 */
export function estimateTokens(message: AgentMessage): number {
  let chars = 0;
  switch (message.role) {
    case "user": {
      chars = contentChars(message.content);
      break;
    }
    case "assistant": {
      for (const block of message.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "toolCall") chars += block.name.length + JSON.stringify(block.arguments).length;
      }
      break;
    }
    case "toolResult": {
      chars = contentChars(message.content);
      break;
    }
    case "custom": {
      chars = contentChars(message.content);
      break;
    }
    case "compactionSummary": {
      chars = message.summary.length;
      break;
    }
  }
  return Math.ceil(chars / 4);
}

export interface ValidUsage {
  usage: { totalTokens: number; input: number; output: number; cacheRead: number; cacheWrite: number };
  timestamp: number;
  index: number;
}

/** Find the last valid assistant usage, skipping aborted/error/all-zero messages. */
export function findLastValidUsage(messages: AgentMessage[]): ValidUsage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const assistant = message as unknown as { stopReason?: string; usage?: { totalTokens: number; input: number; output: number; cacheRead: number; cacheWrite: number }; timestamp?: number };
    if (assistant.stopReason === "aborted" || assistant.stopReason === "error") continue;
    if (assistant.usage && calculateContextTokens(assistant.usage) > 0) {
      return { usage: assistant.usage, timestamp: assistant.timestamp ?? 0, index };
    }
  }
  return undefined;
}

/**
 * Estimate context tokens from messages, using the last valid assistant usage
 * when available and estimating trailing messages with estimateTokens.
 */
export function estimateContextTokens(messages: AgentMessage[]): ContextUsageEstimate {
  const usageInfo = findLastValidUsage(messages);
  if (!usageInfo) {
    let estimated = 0;
    for (const message of messages) estimated += estimateTokens(message);
    return { tokens: estimated, usageTokens: 0, trailingTokens: estimated, lastUsageIndex: null };
  }
  const usageTokens = calculateContextTokens(usageInfo.usage);
  let trailingTokens = 0;
  for (let index = usageInfo.index + 1; index < messages.length; index += 1) {
    trailingTokens += estimateTokens(messages[index]);
  }
  return { tokens: usageTokens + trailingTokens, usageTokens, trailingTokens, lastUsageIndex: usageInfo.index };
}

/** Check whether compaction should trigger based on context usage. */
export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
  if (!settings.enabled) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}

// ============================================================================
// Entry helpers
// ============================================================================

function entryToMessage(entry: PiSessionEntry): AgentMessage | undefined {
  if (entry.type === "message" && entry.message) return entry.message as AgentMessage;
  if (entry.type === "custom_message") {
    return {
      role: "custom",
      customType: typeof entry.customType === "string" ? entry.customType : "litera",
      content: entry.content ?? [],
      display: entry.display === true,
      details: entry.details,
      timestamp: Date.parse(entry.timestamp),
    } as AgentMessage;
  }
  if (entry.type === "compaction" && typeof entry.summary === "string") {
    return {
      role: "compactionSummary",
      summary: entry.summary,
      tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
      timestamp: Date.parse(entry.timestamp),
    } as AgentMessage;
  }
  return undefined;
}

function entryTokens(entry: PiSessionEntry): number {
  const message = entryToMessage(entry);
  return message ? estimateTokens(message) : 0;
}

/** A user-like entry (user message or custom message) is a valid cut point. */
function isCutPointEntry(entry: PiSessionEntry): boolean {
  if (entry.type === "message") {
    return (entry.message as { role?: string })?.role === "user";
  }
  return entry.type === "custom_message";
}

// ============================================================================
// Cut point detection
// ============================================================================

/**
 * Find the cut point in session entries that keeps approximately
 * `keepRecentTokens` tokens of recent history.
 *
 * Walks backwards from the newest entry, accumulating estimated token sizes,
 * and stops once the budget is reached. Only user-like entries (user messages
 * and custom messages) are valid cut points, so a cut never splits a turn.
 *
 * Returns the index of the first entry to keep.
 */
export function findCutPoint(entries: PiSessionEntry[], startIndex: number, endIndex: number, keepRecentTokens: number): number {
  const cutPoints: number[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    if (isCutPointEntry(entries[index])) cutPoints.push(index);
  }
  if (cutPoints.length === 0) return startIndex;
  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0];
  for (let index = endIndex - 1; index >= startIndex; index -= 1) {
    const tokens = entryTokens(entries[index]);
    if (tokens === 0) continue;
    accumulatedTokens += tokens;
    if (accumulatedTokens >= keepRecentTokens) {
      for (const candidate of cutPoints) {
        if (candidate >= index) {
          cutIndex = candidate;
          break;
        }
      }
      break;
    }
  }
  return cutIndex;
}

// ============================================================================
// Compaction preparation
// ============================================================================

/**
 * Prepare compaction for the active branch entries.
 *
 * Locates the previous compaction boundary (for iterative summary updates),
 * computes tokens before compaction, finds the cut point, and collects the
 * messages that will be summarized and discarded.
 *
 * Returns undefined when there is nothing to compact (session too small, or
 * the last entry is already a compaction).
 */
export function prepareCompaction(entries: PiSessionEntry[], settings: CompactionSettings): CompactionPreparation | undefined {
  if (entries.length > 0 && entries[entries.length - 1].type === "compaction") return undefined;
  let prevCompactionIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].type === "compaction") {
      prevCompactionIndex = index;
      break;
    }
  }
  let previousSummary: string | undefined;
  let boundaryStart = 0;
  if (prevCompactionIndex >= 0) {
    const prev = entries[prevCompactionIndex];
    previousSummary = typeof prev.summary === "string" ? prev.summary : undefined;
    const firstKeptIndex = entries.findIndex((entry) => entry.id === prev.firstKeptEntryId);
    boundaryStart = firstKeptIndex >= 0 ? firstKeptIndex : prevCompactionIndex + 1;
  }
  const boundaryEnd = entries.length;
  const tokensBefore = estimateContextTokens(entries.flatMap((entry) => {
    const message = entryToMessage(entry);
    return message ? [message] : [];
  })).tokens;
  const cutIndex = findCutPoint(entries, boundaryStart, boundaryEnd, settings.keepRecentTokens);
  const firstKeptEntry = entries[cutIndex];
  if (!firstKeptEntry?.id) return undefined;
  const messagesToSummarize: AgentMessage[] = [];
  for (let index = boundaryStart; index < cutIndex; index += 1) {
    if (entries[index].type === "compaction") continue;
    const message = entryToMessage(entries[index]);
    if (message) messagesToSummarize.push(message);
  }
  if (messagesToSummarize.length === 0) return undefined;
  return { firstKeptEntryId: firstKeptEntry.id, messagesToSummarize, previousSummary, tokensBefore };
}

// ============================================================================
// Summarization
// ============================================================================

const TOOL_RESULT_MAX_CHARS = 2000;

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const block = part as { type?: string; text?: string };
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("");
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * Serialize LLM messages to plain text for summarization.
 * Prevents the model from treating the conversation as one to continue.
 * Tool results are truncated to keep the request within token budgets.
 */
export function serializeConversation(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = contentText(message.content);
      if (content) parts.push(`[User]: ${content}`);
    } else if (message.role === "assistant") {
      const thinking: string[] = [];
      const toolCalls: string[] = [];
      for (const block of message.content) {
        if (block.type === "thinking") thinking.push(block.thinking);
        else if (block.type === "toolCall") {
          const args = Object.entries(block.arguments)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(", ");
          toolCalls.push(`${block.name}(${args})`);
        }
      }
      if (thinking.length > 0) parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      const text = contentText(message.content);
      if (text) parts.push(`[Assistant]: ${text}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
    } else if (message.role === "toolResult") {
      const content = contentText(message.content);
      if (content) parts.push(`[Tool result]: ${truncate(content, TOOL_RESULT_MAX_CHARS)}`);
    } else if (message.role === "custom") {
      const content = contentText(message.content);
      if (content) parts.push(`[Context]: ${content}`);
    } else if (message.role === "compactionSummary") {
      parts.push(`[Previous summary]: ${message.summary}`);
    }
  }
  return parts.join("\n\n");
}

const SUMMARIZATION_SYSTEM_PROMPT = "You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.";

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact book titles, chapter names, and quoted passages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact book titles, chapter names, and quoted passages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact book titles, chapter names, and quoted passages.`;

/**
 * Generate a summary of the conversation using the LLM.
 * When previousSummary is provided, uses the update prompt to merge.
 *
 * The summarization request is standalone: cache retention is disabled and a
 * fresh session id is used so the summary call never pollutes prompt caching.
 */
export async function generateSummary(
  messages: AgentMessage[],
  model: Model<Api>,
  reserveTokens: number,
  apiKey: string,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.min(Math.floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);
  const basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  const conversationText = serializeConversation(messages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  promptText += basePrompt;
  const context: Context = {
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() }],
  };
  const options: SimpleStreamOptions = {
    maxTokens,
    signal,
    apiKey,
    cacheRetention: "none",
    sessionId: crypto.randomUUID(),
  };
  const stream = await streamFn(model, context, options);
  const response = await stream.result();
  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }
  return contentText(response.content);
}
