import type { StreamFn } from "@earendil-works/pi-agent-core";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import type { RecapChapters } from "./guide";

/** Upper bound on the retelling sent for one recap; a chapter's retelling rarely comes near it. */
const RETELLING_MAX_CHARS = 60_000;
const RECAP_MAX_TOKENS = 1_500;

const RECAP_SYSTEM_PROMPT = "You write chapter recaps for a reading assistant that takes a reader through a book chapter by chapter. Output only the recap.";

const RECAP_PROMPT = `The text in <retelling> is how the assistant took the reader through one chapter of the book, part by part, or through several chapters read in one step (<chapter> names them). Write one recap of it. The assistant keeps it in mind for the rest of the book, after the retelling itself is gone; the reader can look at it to review the chapter.

- Write in the language of the retelling.
- Start with one sentence on what the chapter (or chapters) does in the book.
- Then the main line, in order: the key claims, arguments, events or turns, as a short list (at most 8 items).
- Name the terms, people or concepts the chapter introduces, if any.
- Keep up to 3 of the author's key sentences exactly as the retelling quotes them, as [quoted text](cite:CHAPTER_INDEX) links.
- At most about 250 words (500 characters for Chinese or Japanese). No preamble and no heading.`;

export interface ChapterRecapInput extends RecapChapters {
  bookTitle: string;
  /** The answers to the chapter's guided steps, in order. */
  retelling: readonly string[];
}

function chapterName(chapterIndex: number, chapterTitle?: string): string {
  return chapterTitle ? `chapterIndex ${chapterIndex}, "${chapterTitle}"` : `chapterIndex ${chapterIndex}`;
}

/** The chapter, or the first through the last chapter, a recap covers. */
function recapName(recap: RecapChapters): string {
  const first = chapterName(recap.chapterIndex, recap.chapterTitle);
  return recap.throughChapterIndex === undefined ? first : `${first} through ${chapterName(recap.throughChapterIndex, recap.throughChapterTitle)}`;
}

/** The model-facing text of a recap entry. */
export function guideRecapContext(recap: RecapChapters, text: string): string {
  return `Chapter recap (${recapName(recap)}), written when the guide finished ${recap.throughChapterIndex === undefined ? "this chapter" : "these chapters"}:\n\n${text}`;
}

/**
 * Ask the model for a recap of one finished chapter of a Guided session.
 * Standalone like a Compaction summary: no prompt cache and a fresh session
 * id, so it never disturbs the Session's own cache.
 */
export async function generateChapterRecap(
  input: ChapterRecapInput,
  model: Model<Api>,
  apiKey: string,
  signal: AbortSignal | undefined,
  streamFn: StreamFn,
): Promise<string> {
  const retelling = input.retelling.join("\n\n---\n\n").slice(0, RETELLING_MAX_CHARS);
  const prompt = input.throughChapterIndex === undefined
    ? RECAP_PROMPT.replace("CHAPTER_INDEX", String(input.chapterIndex))
    : `${RECAP_PROMPT}\n- CHAPTER_INDEX is the chapterIndex each quote came from, as in the retelling's own citation links.`;
  const text = `<book>${input.bookTitle}</book>\n<chapter>${recapName(input)}</chapter>\n\n<retelling>\n${retelling}\n</retelling>\n\n${prompt}`;
  const context = normalizeContext({
    systemPrompt: RECAP_SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text }], timestamp: Date.now() }],
  });
  const maxTokens = Math.min(RECAP_MAX_TOKENS, model.maxTokens > 0 ? model.maxTokens : Number.POSITIVE_INFINITY);
  const stream = await streamFn(model, context, { maxTokens, signal, apiKey, cacheRetention: "none", sessionId: crypto.randomUUID() });
  const response = await stream.result();
  if (response.stopReason === "aborted") throw new DOMException("Recap aborted", "AbortError");
  if (response.stopReason === "error") throw new Error(`Recap failed: ${response.errorMessage || "Unknown error"}`);
  const recap = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("").trim();
  if (!recap) throw new Error("Recap returned no text");
  return recap;
}
