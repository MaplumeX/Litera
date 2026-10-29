import type { AgentToolCall, AssistantBlock } from "@/types/agent";

/** Tool calls rendered as their own cards rather than folded into the source summary. */
const STANDALONE_TOOLS = new Set(["draw_mindmap"]);

export interface ChapterCoverage {
  chapterIndex: number;
  chapterNumber: number;
  title?: string;
  /** Distinct parts read, ascending. */
  partsRead: number[];
  totalParts: number;
}

export type SourceLookup = "toc" | "blocks" | "metadata" | "annotations" | "images";

/**
 * What one assistant answer drew on from the Book, derived from its tool
 * calls. A derived view: nothing here is persisted.
 */
export interface SourceSummary {
  /** The tool calls folded into the summary, in call order. */
  calls: AgentToolCall[];
  chapters: ChapterCoverage[];
  searches: number;
  hits: number;
  lookups: SourceLookup[];
  failed: number;
  running: boolean;
}

const LOOKUP_TOOLS: Record<string, SourceLookup> = {
  get_toc: "toc",
  list_guide_blocks: "blocks",
  get_book_metadata: "metadata",
  list_annotations: "annotations",
  view_image: "images",
};

export function isSourceToolCall(call: AgentToolCall): boolean {
  return !STANDALONE_TOOLS.has(call.tool);
}

/**
 * Tool results arrive as the raw tool result while streaming
 * (`{ content: [{ type: "text", text }] }`) and as plain text once the
 * Session is reloaded from disk.
 */
export function toolResultText(result: unknown): string | undefined {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content)) {
    return ((result as { content: unknown[] }).content)
      .map((part) => {
        const block = part as { type?: unknown; text?: unknown } | null;
        return block?.type === "text" && typeof block.text === "string" ? block.text : "";
      })
      .join("");
  }
  return undefined;
}

/** The JSON a Book tool returned, or undefined when the result is not JSON. */
export function resultPayload(result: unknown): unknown {
  const text = toolResultText(result);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function summarizeSources(blocks: readonly AssistantBlock[]): SourceSummary | null {
  const calls = blocks.flatMap((block) =>
    block.type === "toolCall" && isSourceToolCall(block.toolCall) ? [block.toolCall] : [],
  );
  if (calls.length === 0) return null;
  const chapters = new Map<number, ChapterCoverage>();
  const lookups: SourceLookup[] = [];
  let searches = 0;
  let hits = 0;
  let failed = 0;
  let running = false;
  for (const call of calls) {
    if (!call.done) {
      running = true;
      continue;
    }
    if (call.isError) {
      failed += 1;
      continue;
    }
    const payload = resultPayload(call.result);
    if (call.tool === "read_chapter") {
      const read = payload as { chapterIndex?: unknown; chapterNumber?: unknown; chapterTitle?: unknown; part?: unknown; totalParts?: unknown } | undefined;
      const chapterIndex = integer(read?.chapterIndex);
      const part = integer(read?.part);
      const totalParts = integer(read?.totalParts);
      if (chapterIndex === undefined || part === undefined || !totalParts) continue;
      const coverage = chapters.get(chapterIndex) ?? {
        chapterIndex,
        chapterNumber: integer(read?.chapterNumber) ?? chapterIndex + 1,
        ...(typeof read?.chapterTitle === "string" && read.chapterTitle ? { title: read.chapterTitle } : {}),
        partsRead: [],
        totalParts,
      };
      if (!coverage.partsRead.includes(part)) {
        coverage.partsRead = [...coverage.partsRead, part].sort((left, right) => left - right);
      }
      chapters.set(chapterIndex, coverage);
    } else if (call.tool === "search_in_book") {
      searches += 1;
      if (Array.isArray(payload)) hits += payload.length;
    } else {
      const lookup = LOOKUP_TOOLS[call.tool];
      if (lookup && !lookups.includes(lookup)) lookups.push(lookup);
    }
  }
  return { calls, chapters: [...chapters.values()], searches, hits, lookups, failed, running };
}

export function isPartialCoverage(chapter: ChapterCoverage): boolean {
  return chapter.partsRead.length < chapter.totalParts;
}
