/**
 * Litera pi agent sidecar
 *
 * stdio JSON lines protocol:
 *   stdin  → { type: "book_opened", path, bookId }
 *          | { type: "prompt", text, context? }
 *          | { type: "abort" }
 *   stdout → { type: "ready" }
 *          | { type: "book_ready" }
 *          | { type: "text_delta", delta }
 *          | { type: "tool_start", tool, params }
 *          | { type: "tool_end", result }
 *          | { type: "agent_end" }
 *          | { type: "error", message }
 */

import * as readline from "node:readline";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
  defineTool,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  loadBook,
  isBookLoaded,
  getBookMetadata,
  getToc,
  readChapter,
  searchInBook,
  type BookMetadata,
} from "./book.js";

// --- stdio helpers -----------------------------------------------------------

/** Write a JSON line to stdout (protocol output only — never use console.log). */
function sendMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendError(message: string): void {
  sendMessage({ type: "error", message });
}

// --- Custom tools -----------------------------------------------------------

const READING_ASSISTANT_PROMPT = `You are Litera, a reading assistant for EPUB books. You help readers understand the content of the book they are reading.

You have access to the following tools:
- get_book_metadata: Get the book's title, author, language, and total chapter count.
- get_toc: Get the table of contents (chapter index, label, and href).
- read_chapter: Read the full text of a chapter by its index (0-based).
- search_in_book: Search the entire book for a query string, returning matching excerpts with chapter indices.

When to use tools:
- If the user asks about the overall book, call get_book_metadata or get_toc first.
- If the user asks about a specific chapter or topic, call read_chapter with the chapter index, or search_in_book to find relevant passages.
- If the user selected text and asks a question about it, the selected text is included in the prompt. You may still call read_chapter to get more context from the surrounding chapter.

Always answer in the same language as the user's question. Be concise but thorough.`;

/** Wrap an error message into a tool result (for tool execute catch blocks). */
function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { error: true },
  };
}

function okResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

const getBookMetadataTool = defineTool({
  name: "get_book_metadata",
  label: "Get Book Metadata",
  description: "Get the book's title, author, language, and total chapter count.",
  promptSnippet: "get_book_metadata: get book title, author, language, chapter count",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isBookLoaded()) return errorResult("No book loaded. Open a book first.");
    const meta: BookMetadata = getBookMetadata();
    return okResult(
      `Title: ${meta.title}\nAuthor: ${meta.author}\nLanguage: ${meta.language}\nTotal chapters: ${meta.totalChapters}`,
    );
  },
});

const getTocTool = defineTool({
  name: "get_toc",
  label: "Get Table of Contents",
  description: "Get the table of contents: list of chapters with index, label, and href.",
  promptSnippet: "get_toc: list all chapters with index and label",
  parameters: Type.Object({}),
  execute: async () => {
    if (!isBookLoaded()) return errorResult("No book loaded. Open a book first.");
    const toc = getToc();
    const lines = toc.map((e) => `${e.index}: ${e.label} (${e.href})`);
    return okResult(`Table of Contents (${toc.length} entries):\n${lines.join("\n")}`);
  },
});

const readChapterTool = defineTool({
  name: "read_chapter",
  label: "Read Chapter",
  description: "Read the full text of a chapter by its index (0-based, from the TOC).",
  promptSnippet: "read_chapter(index): read full text of chapter by index",
  parameters: Type.Object({ index: Type.Number({ description: "0-based chapter index" }) }),
  execute: async (_, { index }) => {
    if (!isBookLoaded()) return errorResult("No book loaded. Open a book first.");
    try {
      const text = readChapter(index);
      return okResult(text);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
});

const searchInBookTool = defineTool({
  name: "search_in_book",
  label: "Search in Book",
  description: "Search the entire book for a query string. Returns matching excerpts with chapter indices. Uses trigram tokenization, so queries of 3+ characters work best.",
  promptSnippet: "search_in_book(query): full-text search returning excerpts with chapter indices",
  parameters: Type.Object({ query: Type.String({ description: "Search query (3+ characters for best results)" }) }),
  execute: async (_, { query }) => {
    if (!isBookLoaded()) return errorResult("No book loaded. Open a book first.");
    try {
      const results = searchInBook(query);
      if (results.length === 0) {
        return okResult(`No matches found for "${query}".`);
      }
      const lines = results.map(
        (r) => `[Chapter ${r.chapterIndex}] ${r.excerpt}`,
      );
      return okResult(`Found ${results.length} matches for "${query}":\n\n${lines.join("\n\n")}`);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
});

const customTools: ToolDefinition[] = [
  getBookMetadataTool,
  getTocTool,
  readChapterTool,
  searchInBookTool,
];

// --- Agent session lifecycle -------------------------------------------------

let session: AgentSession | null = null;
let unsubscribe: (() => void) | null = null;

async function initSession(): Promise<void> {
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.env.HOME ? `${process.env.HOME}/.pi/agent` : "/tmp/.pi/agent",
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => READING_ASSISTANT_PROMPT,
  });
  await resourceLoader.reload();

  const { session: s } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    customTools,
    resourceLoader,
  });

  session = s;

  unsubscribe = s.subscribe((event) => {
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          sendMessage({ type: "text_delta", delta: event.assistantMessageEvent.delta });
        }
        break;

      case "tool_execution_start":
        sendMessage({
          type: "tool_start",
          tool: event.toolName,
          params: event.args,
        });
        break;

      case "tool_execution_end":
        sendMessage({
          type: "tool_end",
          result: event.result,
        });
        break;

      case "agent_end":
        sendMessage({ type: "agent_end" });
        break;
    }
  });
}

// --- Book handling -----------------------------------------------------------

async function handleBookOpened(path: string): Promise<void> {
  try {
    await loadBook(path);
    sendMessage({ type: "book_ready" });
  } catch (err) {
    sendError(`Failed to load book: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Prompt handling ---------------------------------------------------------

interface PromptContext {
  selection?: string;
  chapterIndex?: number;
}

async function handlePrompt(text: string, context?: PromptContext): Promise<void> {
  if (!session) {
    sendError("Agent session not initialized");
    return;
  }
  try {
    const fullPrompt = buildPromptWithContext(text, context);
    await session.prompt(fullPrompt);
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  }
}

/** Construct the full prompt with optional selection/chapter context. */
function buildPromptWithContext(text: string, context?: PromptContext): string {
  if (!context) return text;

  const parts: string[] = [];
  if (context.selection) {
    parts.push(`用户选中的文本：\n"${context.selection}"`);
  }
  if (context.chapterIndex !== undefined && !context.selection) {
    parts.push(`（当前在第 ${context.chapterIndex} 章）`);
  }
  parts.push(`用户问题：${text}`);
  return parts.join("\n\n");
}

async function handleAbort(): Promise<void> {
  if (!session) return;
  try {
    await session.abort();
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  }
}

// --- main --------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    await initSession();
  } catch (err) {
    sendError(
      `Failed to initialize agent session: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: undefined, // don't echo to stdout
    terminal: false,
  });

  rl.on("line", (line: string) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      sendError(`Invalid JSON input: ${line}`);
      return;
    }

    const typed = msg as Record<string, unknown>;
    if (typeof typed.type !== "string") {
      sendError("Missing 'type' field in input");
      return;
    }

    switch (typed.type) {
      case "book_opened": {
        if (typeof typed.path !== "string") {
          sendError("book_opened requires a 'path' string field");
          return;
        }
        void handleBookOpened(typed.path);
        break;
      }

      case "prompt": {
        if (typeof typed.text !== "string") {
          sendError("Prompt requires a 'text' string field");
          return;
        }
        const context =
          typed.context && typeof typed.context === "object"
            ? (typed.context as PromptContext)
            : undefined;
        void handlePrompt(typed.text, context);
        break;
      }

      case "abort":
        void handleAbort();
        break;

      default:
        sendError(`Unknown message type: ${typed.type}`);
    }
  });

  rl.on("close", () => {
    if (unsubscribe) unsubscribe();
    if (session) session.dispose();
    process.exit(0);
  });

  // Signal that sidecar is ready.
  sendMessage({ type: "ready" });
}

void main();