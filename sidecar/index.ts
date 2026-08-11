/**
 * Litera pi agent sidecar
 *
 * stdio JSON lines protocol:
 *   stdin  → { type: "book_opened", path, bookId, sessionsDir }
 *          | { type: "prompt", text, context? }
 *          | { type: "abort" }
 *          | { type: "new_session", bookId }
 *          | { type: "switch_session", sessionId }
 *          | { type: "delete_session", sessionId }
 *          | { type: "list_sessions", bookId }
 *   stdout → { type: "ready" }
 *          | { type: "book_ready" }
 *          | { type: "text_delta", delta }
 *          | { type: "tool_start", tool, params }
 *          | { type: "tool_end", result }
 *          | { type: "agent_end" }
 *          | { type: "error", message }
 *          | { type: "session_created", sessionId }
 *          | { type: "session_switched", sessionId, messages }
 *          | { type: "session_deleted", sessionId }
 *          | { type: "sessions_list", sessions }
 */

import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
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

// --- Multi-session management -----------------------------------------------

/** A managed agent session with its unsubscribe handle and bookId. */
interface ManagedSession {
  session: AgentSession;
  unsubscribe: () => void;
  bookId: string;
  /** File path of the session jsonl (for deletion). */
  filePath: string;
}

/** All active sessions keyed by sessionId. */
const sessions = new Map<string, ManagedSession>();
let currentSessionId: string | null = null;

/** Sessions directory passed by Rust (Tauri app data dir + "/sessions"). */
let sessionsDir: string | null = null;
let currentBookId: string | null = null;

function makeResourceLoader() {
  return new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: process.env.HOME ? `${process.env.HOME}/.pi/agent` : "/tmp/.pi/agent",
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => READING_ASSISTANT_PROMPT,
  });
}

/**
 * Load a session from disk into memory (e.g. after sidecar restart).
 * Returns the ManagedSession or null if not found on disk.
 */
async function loadSessionFromDisk(sessionId: string, bookId: string): Promise<ManagedSession | null> {
  if (!sessionsDir) return null;
  const sessionDir = join(sessionsDir, bookId);
  try {
    const infos = await SessionManager.list(process.cwd(), sessionDir);
    const info = infos.find((i) => i.id === sessionId);
    if (!info) return null;

    const sessionManager = SessionManager.open(info.path, sessionDir);
    const resourceLoader = makeResourceLoader();
    await resourceLoader.reload();

    const { session: s } = await createAgentSession({
      sessionManager,
      customTools,
      resourceLoader,
    });

    const unsubscribe = subscribeSession(sessionId, s);
    const managed: ManagedSession = { session: s, unsubscribe, bookId, filePath: info.path };
    sessions.set(sessionId, managed);
    return managed;
  } catch {
    return null;
  }
}

/** Subscribe to a session's events, forwarding to stdout only when it is active. */
function subscribeSession(id: string, s: AgentSession): () => void {
  return s.subscribe((event) => {
    // Only forward events for the currently active session.
    if (currentSessionId !== id) return;
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

async function handleNewSession(bookId: string): Promise<void> {
  if (!sessionsDir) {
    sendError("Cannot create session: no sessionsDir set (book not opened)");
    return;
  }
  const sessionId = randomUUID();
  const sessionDir = join(sessionsDir, bookId);
  const sessionManager = SessionManager.create(process.cwd(), sessionDir, { id: sessionId });
  const filePath = sessionManager.getSessionFile();
  if (!filePath) {
    sendError("Failed to determine session file path");
    return;
  }

  const resourceLoader = makeResourceLoader();
  await resourceLoader.reload();

  const { session: s } = await createAgentSession({
    sessionManager,
    customTools,
    resourceLoader,
  });

  const unsubscribe = subscribeSession(sessionId, s);
  sessions.set(sessionId, { session: s, unsubscribe, bookId, filePath });
  currentSessionId = sessionId;
  currentBookId = bookId;
  sendMessage({ type: "session_created", sessionId });
}

async function handleSwitchSession(sessionId: string): Promise<void> {
  // If the session is already in memory, switch directly.
  let managed = sessions.get(sessionId);
  if (!managed) {
    // Session not in memory — try loading from disk (e.g. after sidecar restart).
    if (!sessionsDir || !currentBookId) {
      sendError(`Session not found: ${sessionId}`);
      return;
    }
    const loaded = await loadSessionFromDisk(sessionId, currentBookId);
    if (!loaded) {
      sendError(`Session not found: ${sessionId}`);
      return;
    }
    managed = loaded;
  }
  currentSessionId = sessionId;
  currentBookId = managed.bookId;
  sendMessage({
    type: "session_switched",
    sessionId,
    messages: serializeMessages(managed.session.messages),
  });
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  const managed = sessions.get(sessionId);
  if (managed) {
    // Session is in memory — release resources and delete file.
    managed.unsubscribe();
    managed.session.dispose();
    sessions.delete(sessionId);
    try {
      await unlink(managed.filePath);
    } catch {
      // File may already be gone — best effort.
    }
  } else {
    // Session not in memory — try deleting the file from disk directly.
    if (!sessionsDir || !currentBookId) {
      sendError(`Session not found: ${sessionId}`);
      return;
    }
    const sessionDir = join(sessionsDir, currentBookId);
    try {
      const infos = await SessionManager.list(process.cwd(), sessionDir);
      const target = infos.find((info) => info.id === sessionId);
      if (!target) {
        sendError(`Session not found: ${sessionId}`);
        return;
      }
      await unlink(target.path);
    } catch (err) {
      sendError(`Failed to delete session: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }
  if (currentSessionId === sessionId) currentSessionId = null;
  sendMessage({ type: "session_deleted", sessionId });
}

async function handleListSessions(bookId: string): Promise<void> {
  if (!sessionsDir) {
    sendError("Cannot list sessions: no sessionsDir set (book not opened)");
    return;
  }
  const sessionDir = join(sessionsDir, bookId);
  try {
    const infos = await SessionManager.list(process.cwd(), sessionDir);
    const summaries = infos.map((info) => ({
      id: info.id,
      title: deriveTitle(info.firstMessage, info.name),
      createdAt: info.created.toISOString(),
      updatedAt: info.modified.toISOString(),
    }));
    sendMessage({ type: "sessions_list", sessions: summaries });
  } catch (err) {
    sendError(`Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Derive a display title: explicit name, else first user message truncated to 30 chars, else "New Session". */
function deriveTitle(firstMessage: string, name?: string): string {
  if (name && name.trim()) return name;
  if (firstMessage && firstMessage !== "(no messages)") {
    return firstMessage.slice(0, 30);
  }
  return "New Session";
}

// --- Message serialization (for session_switched history) -------------------

interface SerializedMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: { tool: string; params: unknown; result?: unknown; done: boolean }[];
}

/** Convert session messages to a simple array the frontend can render. */
function serializeMessages(messages: readonly unknown[]): SerializedMessage[] {
  // Build a lookup from toolCallId → tool result for matching tool calls to results.
  const toolResults = new Map<string, unknown>();
  for (const msg of messages) {
    const m = msg as { role?: string };
    if (typeof msg === "object" && msg !== null && m.role === "toolResult") {
      const tr = msg as { toolCallId: string; content: { type: string; text: string }[] };
      const text = tr.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("");
      toolResults.set(tr.toolCallId, text);
    }
  }

  const result: SerializedMessage[] = [];
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null) continue;
    const role = (msg as { role?: string }).role;
    if (role === "user") {
      const content = extractUserText((msg as { content: string | { type: string; text: string }[] }).content);
      result.push({ role: "user", content });
    } else if (role === "assistant") {
      const am = msg as {
        content: { type: string; text?: string; id?: string; name?: string; arguments?: Record<string, unknown> }[];
      };
      const textParts: string[] = [];
      const toolCalls: SerializedMessage["toolCalls"] = [];
      for (const block of am.content) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "toolCall" && block.id && block.name) {
          toolCalls.push({
            tool: block.name,
            params: block.arguments ?? {},
            result: toolResults.get(block.id),
            done: toolResults.has(block.id),
          });
        }
      }
      result.push({ role: "assistant", content: textParts.join(""), toolCalls: toolCalls.length ? toolCalls : undefined });
    }
  }
  return result;
}

/** Extract plain text from a user message content field. */
function extractUserText(content: string | { type: string; text: string }[]): string {
  if (typeof content === "string") return content;
  return content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

// --- Book handling -----------------------------------------------------------

async function handleBookOpened(path: string, bookId: string, dir: string): Promise<void> {
  try {
    await loadBook(path);
    sessionsDir = dir;
    currentBookId = bookId;
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
  if (!currentSessionId) {
    sendError("No active session. Create or switch to a session first.");
    return;
  }
  const managed = sessions.get(currentSessionId);
  if (!managed) {
    sendError("Active session not found");
    return;
  }
  try {
    const fullPrompt = buildPromptWithContext(text, context);
    await managed.session.prompt(fullPrompt);
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
  if (!currentSessionId) return;
  const managed = sessions.get(currentSessionId);
  if (!managed) return;
  try {
    await managed.session.abort();
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  }
}

// --- main --------------------------------------------------------------------

async function main(): Promise<void> {
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
        if (typeof typed.path !== "string" || typeof typed.bookId !== "string" || typeof typed.sessionsDir !== "string") {
          sendError("book_opened requires 'path', 'bookId', and 'sessionsDir' string fields");
          return;
        }
        void handleBookOpened(typed.path, typed.bookId, typed.sessionsDir);
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

      case "new_session": {
        if (typeof typed.bookId !== "string") {
          sendError("new_session requires a 'bookId' string field");
          return;
        }
        void handleNewSession(typed.bookId).catch((err) =>
          sendError(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`),
        );
        break;
      }

      case "switch_session": {
        if (typeof typed.sessionId !== "string") {
          sendError("switch_session requires a 'sessionId' string field");
          return;
        }
        void handleSwitchSession(typed.sessionId).catch((err) =>
          sendError(`Failed to switch session: ${err instanceof Error ? err.message : String(err)}`),
        );
        break;
      }

      case "delete_session": {
        if (typeof typed.sessionId !== "string") {
          sendError("delete_session requires a 'sessionId' string field");
          return;
        }
        void handleDeleteSession(typed.sessionId).catch((err) =>
          sendError(`Failed to delete session: ${err instanceof Error ? err.message : String(err)}`),
        );
        break;
      }

      case "list_sessions": {
        if (typeof typed.bookId !== "string") {
          sendError("list_sessions requires a 'bookId' string field");
          return;
        }
        void handleListSessions(typed.bookId).catch((err) =>
          sendError(`Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`),
        );
        break;
      }

      default:
        sendError(`Unknown message type: ${typed.type}`);
    }
  });

  rl.on("close", () => {
    for (const managed of sessions.values()) {
      managed.unsubscribe();
      managed.session.dispose();
    }
    sessions.clear();
    process.exit(0);
  });

  // Signal that sidecar is ready.
  sendMessage({ type: "ready" });
}

void main();