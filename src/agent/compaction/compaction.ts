import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { normalizeContext, type Api, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { isPrunableEntry, type PiSessionEntry } from "@/agent/sessions/pi-session";
import { imageRefSource } from "@/agent/sessions/image-refs";

/**
 * Context thresholds for one model, all in tokens. Pruning clears re-fetchable
 * Book text past `pruneAt`; Compaction summarizes older turns past `compactAt`.
 * Both keep roughly `keepRecent` tokens of the latest turns untouched.
 */
export interface ContextBudget {
  pruneAt: number;
  compactAt: number;
  keepRecent: number;
  summaryMaxTokens: number;
}

/** Budget scaled to the model's context window; undefined disables maintenance. */
export function contextBudget(contextWindow: number): ContextBudget | undefined {
  if (!(contextWindow > 0)) return undefined;
  return {
    pruneAt: Math.floor(Math.min(contextWindow * 0.5, 100_000)),
    compactAt: Math.floor(contextWindow - Math.min(16_384, contextWindow * 0.15)),
    keepRecent: Math.floor(Math.min(contextWindow * 0.25, 40_000)),
    summaryMaxTokens: Math.floor(Math.min(8_192, contextWindow * 0.1)),
  };
}

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

// Book images are fitted to ~1.15 MP (see model-image), about 1600 tokens.
const ESTIMATED_IMAGE_TOKENS = 1600;
// CJK ideographs, kana, hangul and full-width forms: roughly one token each.
const WIDE_CHARS = /[　-鿿가-힯豈-﫿＀-￯]/g;

/**
 * Conservative token estimate for text: chars/4, except CJK characters, which
 * tokenize near one token per character (chars/4 would undercount Chinese
 * books several times over).
 */
function textTokens(text: string): number {
  const wide = text.match(WIDE_CHARS)?.length ?? 0;
  return wide + (text.length - wide) / 4;
}

function contentTokens(content: unknown): number {
  if (typeof content === "string") return textTokens(content);
  if (!Array.isArray(content)) return 0;
  let tokens = 0;
  for (const block of content) {
    const part = block as { type?: string; text?: string };
    // An Image reference is re-sent as the image itself.
    if (part?.type === "text" && typeof part.text === "string") tokens += imageRefSource(part.text) ? ESTIMATED_IMAGE_TOKENS : textTokens(part.text);
    else if (part?.type === "image") tokens += ESTIMATED_IMAGE_TOKENS;
  }
  return tokens;
}

/** Estimate the token count of a message (conservative: overestimates). */
export function estimateTokens(message: AgentMessage): number {
  let tokens = 0;
  switch (message.role) {
    case "user":
    case "toolResult":
    case "custom": {
      tokens = contentTokens(message.content);
      break;
    }
    case "assistant": {
      for (const block of message.content) {
        if (block.type === "text") tokens += textTokens(block.text);
        else if (block.type === "thinking") tokens += textTokens(block.thinking);
        else if (block.type === "toolCall") tokens += textTokens(block.name + JSON.stringify(block.arguments));
      }
      break;
    }
    case "compactionSummary": {
      tokens = textTokens(message.summary);
      break;
    }
  }
  return Math.ceil(tokens);
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

// ============================================================================
// Entry helpers
// ============================================================================

export function entryToMessage(entry: PiSessionEntry): AgentMessage | undefined {
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

export function entryTokens(entry: PiSessionEntry): number {
  const message = entryToMessage(entry);
  return message ? estimateTokens(message) : 0;
}

/**
 * Context size of `context` (the `contextBranch` of the active branch `path`).
 * Trusts the last assistant usage unless a Pruning or Compaction entry came
 * after it — that usage measured a context that no longer exists — and then
 * estimates every message instead.
 */
export function estimateBranchTokens(path: PiSessionEntry[], context: PiSessionEntry[]): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index];
    if (entry.type === "compaction" || entry.type === "context_prune") {
      return context.reduce((sum, item) => sum + entryTokens(item), 0);
    }
    const message = entry.type === "message" ? entry.message as AgentMessage : undefined;
    if (message && findLastValidUsage([message])) break;
  }
  return estimateContextTokens(context.flatMap((entry) => {
    const message = entryToMessage(entry);
    return message ? [message] : [];
  })).tokens;
}

function isUserEntry(entry: PiSessionEntry): boolean {
  return entry.type === "message" && (entry.message as { role?: string })?.role === "user";
}

// ============================================================================
// Cut point detection
// ============================================================================

/**
 * Valid cuts in [startIndex, endIndex): each user message (`user`), with the
 * cut moved back over the custom messages (reading context, Book snapshot)
 * directly before it (`cut`), so a cut never splits a turn from the context
 * it was asked in.
 */
function cutPoints(entries: PiSessionEntry[], startIndex: number, endIndex: number): Array<{ cut: number; user: number }> {
  const points: Array<{ cut: number; user: number }> = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    if (!isUserEntry(entries[index])) continue;
    let cut = index;
    while (cut - 1 >= startIndex && entries[cut - 1].type === "custom_message") cut -= 1;
    points.push({ cut, user: index });
  }
  return points;
}

/**
 * Find the cut point in session entries that keeps approximately
 * `keepRecentTokens` tokens of recent history.
 *
 * Walks backwards from the newest entry, accumulating estimated token sizes,
 * and stops once the budget is reached. Only turn starts are valid cut points
 * (see `cutPoints`), so a cut never splits a turn.
 *
 * Returns the index of the first entry to keep.
 */
export function findCutPoint(entries: PiSessionEntry[], startIndex: number, endIndex: number, keepRecentTokens: number): number {
  const points = cutPoints(entries, startIndex, endIndex);
  if (points.length === 0) return startIndex;
  let accumulatedTokens = 0;
  let cutIndex = points[0].cut;
  for (let index = endIndex - 1; index >= startIndex; index -= 1) {
    const tokens = entryTokens(entries[index]);
    if (tokens === 0) continue;
    accumulatedTokens += tokens;
    if (accumulatedTokens >= keepRecentTokens) {
      // When the latest turn alone exceeds the budget, keep just that turn.
      cutIndex = (points.find((candidate) => candidate.user >= index) ?? points[points.length - 1]).cut;
      break;
    }
  }
  return cutIndex;
}

// ============================================================================
// Pruning preparation
// ============================================================================

export interface PrunePreparation {
  /** Last entry whose prunable tool results are cleared. */
  throughEntryId: string;
  /** Estimated tokens the prune frees. */
  tokensSaved: number;
}

/** Placeholder size per pruned result, for the savings estimate. */
const PRUNED_PLACEHOLDER_TOKENS = 40;

/**
 * Prepare a Pruning of the model context (`contextBranch` entries): clear every
 * not-yet-pruned Book tool result older than the latest turns that fit in
 * `keepRecent`. One batch per trigger keeps the provider's prompt-cache prefix
 * stable between prunes.
 *
 * Returns undefined when nothing older than the kept turns can be pruned.
 */
export function preparePrune(entries: PiSessionEntry[], budget: ContextBudget): PrunePreparation | undefined {
  const cutIndex = findCutPoint(entries, 0, entries.length, budget.keepRecent);
  let tokensSaved = 0;
  let found = false;
  for (let index = 0; index < cutIndex; index += 1) {
    if (!isPrunableEntry(entries[index])) continue;
    found = true;
    tokensSaved += Math.max(0, entryTokens(entries[index]) - PRUNED_PLACEHOLDER_TOKENS);
  }
  const through = entries[cutIndex - 1];
  if (!found || !through) return undefined;
  return { throughEntryId: through.id, tokensSaved };
}

// ============================================================================
// Compaction preparation
// ============================================================================

/**
 * Prepare compaction for the model context (`contextBranch` entries).
 *
 * Locates the previous compaction boundary (for iterative summary updates),
 * computes tokens before compaction, finds the cut point, and collects the
 * messages that will be summarized and discarded.
 *
 * Returns undefined when there is nothing to compact (session too small, or
 * the last entry is already a compaction).
 */
export function prepareCompaction(entries: PiSessionEntry[], keepRecent: number): CompactionPreparation | undefined {
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
  const cutIndex = findCutPoint(entries, boundaryStart, boundaryEnd, keepRecent);
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

const TOOL_RESULT_MAX_CHARS = 1500;

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
 *
 * Plain text keeps the model from continuing the conversation. Thinking is
 * dropped, Book text from read_chapter is omitted (it can be read again), the
 * Book snapshot is skipped (re-inserted when absent from the context), and
 * other tool results are truncated.
 */
export function serializeConversation(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = contentText(message.content);
      if (content) parts.push(`[Reader]: ${content}`);
    } else if (message.role === "assistant") {
      const toolCalls: string[] = [];
      for (const block of message.content) {
        if (block.type !== "toolCall") continue;
        const args = Object.entries(block.arguments)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(", ");
        toolCalls.push(`${block.name}(${args})`);
      }
      const text = contentText(message.content);
      if (text) parts.push(`[Assistant]: ${text}`);
      if (toolCalls.length > 0) parts.push(`[Assistant tool calls]: ${toolCalls.join("; ")}`);
    } else if (message.role === "toolResult") {
      if (message.toolName === "read_chapter") continue;
      const content = contentText(message.content);
      if (content) parts.push(`[Tool result ${message.toolName}]: ${truncate(content, TOOL_RESULT_MAX_CHARS)}`);
    } else if (message.role === "custom") {
      if (message.customType === "bookSnapshot") continue;
      const content = contentText(message.content);
      if (content) parts.push(`[Reading context]: ${content}`);
    } else if (message.role === "compactionSummary") {
      parts.push(`[Previous summary]: ${message.summary}`);
    }
  }
  return parts.join("\n\n");
}

const SUMMARIZATION_SYSTEM_PROMPT = "You are a context summarization assistant for a reading assistant. You read a conversation between a reader and an AI assistant about a book, then write a structured summary in the exact format requested.\n\nDo NOT continue the conversation. Do NOT answer any questions in the conversation. ONLY output the summary.";

const SUMMARY_FORMAT = `Use this EXACT structure (Markdown headings), writing headings and content in the language the reader uses:

## Scope
- [Which parts of the book were discussed: chapter titles with their chapterIndex, and the reading position or selections the reader asked about]

## Reader's questions and views
- [What the reader asked, wanted, or argued; their interpretations, preferences, and requested answer style]

## Key points
- [Conclusions, explanations and analyses the assistant gave, as compact facts about the book]

## Citations
- [Verbatim quotes worth keeping, exactly as written, in the form [quote](cite:CHAPTER_INDEX)]
- [Or "(none)"]

## Open questions
- [What is unresolved or what the reader was about to ask next]
- [Or "(none)"]

Keep each section concise. Preserve exact book titles, chapter names, character names and quoted passages. Do not record which tools were called or what text was read verbatim; the assistant can read the book again.`;

const SUMMARIZATION_PROMPT = `The messages above are a conversation about a book. Write a summary that another assistant will use to continue the conversation without the original messages.

${SUMMARY_FORMAT}`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to merge into the existing summary in <previous-summary> tags.

Update the summary. RULES:
- PRESERVE everything still relevant from the previous summary
- ADD new scope, questions, key points, citations and open questions from the new messages
- MOVE open questions that were answered into Key points
- You may drop details that are clearly no longer relevant

${SUMMARY_FORMAT}`;

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
  maxSummaryTokens: number,
  apiKey: string,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.min(maxSummaryTokens, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);
  const basePrompt = previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT;
  const conversationText = serializeConversation(messages);
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
  if (previousSummary) promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  promptText += basePrompt;
  const context = normalizeContext({
    systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() }],
  });
  const options: SimpleStreamOptions = {
    maxTokens,
    signal,
    apiKey,
    cacheRetention: "none",
    sessionId: crypto.randomUUID(),
  };
  const stream = await streamFn(model, context, options);
  const response = await stream.result();
  if (response.stopReason === "aborted") throw new DOMException("Summarization aborted", "AbortError");
  if (response.stopReason === "error") {
    throw new Error(`Summarization failed: ${response.errorMessage || "Unknown error"}`);
  }
  const summary = contentText(response.content).trim();
  if (!summary) throw new Error("Summarization returned no text");
  return summary;
}
