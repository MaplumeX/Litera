import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  SessionManager,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  BOOK_SNAPSHOT_CUSTOM_TYPE,
  formatBookSnapshot,
  sessionHasBookSnapshot,
} from "./book-snapshot.js";
import { BookWorker, isBookWorkerThread, runBookWorker } from "./book-worker.js";
import {
  BookLoadGate,
  BoundedCancellationSet,
  BoundedOutputQueue,
  SerialDispatcher,
  SupersedingResource,
} from "./dispatcher.js";
import {
  AGENT_PROTOCOL_VERSION,
  encodeEvent,
  parseCommandLine,
  ProtocolDecodeError,
  MAX_SESSION_TITLE_LENGTH,
  type PromptContext,
  type SerializedMessage,
  type SerializedToolCall,
  type SidecarCommand,
  type SidecarEvent,
} from "./protocol.js";

const ABORT_TIMEOUT_MS = 2_000;

const READING_ASSISTANT_PROMPT = `You are Litera, a reading assistant for EPUB books. You help readers understand the content of the book they are reading.

Each session receives a book snapshot aside with the current book's title, author, language, chapter count, and a compact table of contents. Do not call get_book_metadata or get_toc unless that snapshot is missing, the TOC is truncated, or you need chapter hrefs.

You have access to the following tools:
- read_chapter: Read the full text of a chapter by its index (0-based).
- search_in_book: Search the entire book for a query string, returning matching excerpts with chapter indices.
- get_book_metadata: Fallback — get the book's title, author, language, and total chapter count if the snapshot is missing.
- get_toc: Fallback — get the full table of contents (chapter index, label, and href) if the snapshot TOC is truncated or you need hrefs.

Always answer in the same language as the user's question. Be concise but thorough.`;

type SidecarEventPayload = SidecarEvent extends infer Event
  ? Event extends { protocolVersion: 1; seq: number }
    ? Omit<Event, "protocolVersion" | "seq">
    : never
  : never;

interface ManagedSession {
  session: AgentSession;
  unsubscribe: () => void;
  bookId: string;
  filePath: string;
  generation: number;
}

interface CurrentBook {
  id: string;
  path: string;
  sessionsDir: string;
  generation: number;
  phase: "loading" | "ready";
}

interface ActivePrompt {
  requestId: string;
  promptId: string;
  bookId: string;
  sessionId: string;
}

let nextSeq = 1;
const bookWorkers = new SupersedingResource(
  () => new BookWorker(),
  (error) => process.stderr.write(`[book-worker] terminate failed: ${error instanceof Error ? error.message : String(error)}\n`),
);
const bookLoadGate = new BookLoadGate();
const sessions = new Map<string, ManagedSession>();
const cancelledPromptIds = new BoundedCancellationSet();
let currentBook: CurrentBook | null = null;
let currentSessionId: string | null = null;
let agentDir: string | null = null;
let activePrompt: ActivePrompt | null = null;
let ftsReady = false;
const protocolOutput = new BoundedOutputQueue(process.stdout, () => {
  process.stderr.write("[protocol] stdout backpressure queue overflowed; terminating for supervisor recovery\n");
  process.exit(1);
});

function sendEvent(payload: SidecarEventPayload): void {
  const event = {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    seq: nextSeq++,
    ...payload,
  } as SidecarEvent;
  protocolOutput.write(encodeEvent(event));
}

function sendError(
  scope: string,
  message: string,
  correlation: {
    requestId?: string;
    bookId?: string;
    sessionId?: string;
    promptId?: string;
  } = {},
  recoverable = true,
): void {
  sendEvent({ type: "error", scope, message, recoverable, ...correlation });
}

function commandCorrelation(command: SidecarCommand): {
  requestId: string;
  bookId?: string;
  sessionId?: string;
  promptId?: string;
} {
  return {
    requestId: command.requestId,
    bookId: "bookId" in command ? command.bookId : undefined,
    sessionId: "sessionId" in command ? command.sessionId : undefined,
    promptId: "promptId" in command ? command.promptId : undefined,
  };
}

function requireBookWorker(): BookWorker {
  const worker = bookWorkers.current();
  if (!worker) throw new Error("Book worker is unavailable");
  return worker;
}

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

function createBookTools(bookId: string, generation: number): ToolDefinition[] {
  const worker = (): BookWorker => {
    if (!bookLoadGate.accepts(generation, bookId)) {
      throw new Error("Book context changed before tool execution");
    }
    return requireBookWorker();
  };
  return [
    defineTool({
      name: "get_book_metadata",
      label: "Get Book Metadata",
      description: "Get the book's title, author, language, and total chapter count.",
      promptSnippet: "get_book_metadata: get book title, author, language, chapter count",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const meta = await worker().metadata(bookId, generation);
          return okResult(`Title: ${meta.title}\nAuthor: ${meta.author}\nLanguage: ${meta.language}\nTotal chapters: ${meta.totalChapters}`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
    defineTool({
      name: "get_toc",
      label: "Get Table of Contents",
      description: "Get the table of contents: list of chapters with index, label, and href.",
      promptSnippet: "get_toc: list all chapters with index and label",
      parameters: Type.Object({}),
      execute: async () => {
        try {
          const toc = await worker().toc(bookId, generation);
          return okResult(`Table of Contents (${toc.length} entries):\n${toc.map((entry) => `${entry.index}: ${entry.label} (${entry.href})`).join("\n")}`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
    defineTool({
      name: "read_chapter",
      label: "Read Chapter",
      description: "Read the full text of a chapter by its index (0-based, from the TOC).",
      promptSnippet: "read_chapter(index): read full text of chapter by index",
      parameters: Type.Object({ index: Type.Number({ description: "0-based chapter index" }) }),
      execute: async (_, { index }) => {
        try {
          return okResult(await worker().readChapter(bookId, generation, index));
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
    defineTool({
      name: "search_in_book",
      label: "Search in Book",
      description: "Search the entire book for a query string and return matching excerpts.",
      promptSnippet: "search_in_book(query): full-text search returning excerpts with chapter indices",
      parameters: Type.Object({ query: Type.String({ description: "Search query" }) }),
      execute: async (_, { query }) => {
        try {
          const results = await worker().search(bookId, generation, query);
          if (results.length === 0) return okResult(`No matches found for "${query}".`);
          return okResult(`Found ${results.length} matches:\n\n${results.map((result) => `[Chapter ${result.chapterIndex}] ${result.excerpt}`).join("\n\n")}`);
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
  ];
}

function makeResourceLoader() {
  if (!agentDir) throw new Error("Agent directory not configured");
  return new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => READING_ASSISTANT_PROMPT,
  });
}

function subscribeSession(id: string, session: AgentSession): () => void {
  return session.subscribe((event) => {
    const prompt = activePrompt;
    if (!prompt || prompt.sessionId !== id || currentBook?.id !== prompt.bookId) return;
    const correlation = {
      bookId: prompt.bookId,
      sessionId: prompt.sessionId,
      promptId: prompt.promptId,
    };
    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          sendEvent({ type: "text_delta", ...correlation, delta: event.assistantMessageEvent.delta });
        }
        break;
      case "tool_execution_start":
        sendEvent({
          type: "tool_start",
          ...correlation,
          toolCallId: event.toolCallId,
          tool: event.toolName,
          params: event.args,
        });
        break;
      case "tool_execution_end":
        sendEvent({
          type: "tool_end",
          ...correlation,
          toolCallId: event.toolCallId,
          result: event.result,
          isError: event.isError,
        });
        break;
    }
  });
}

async function createSession(bookId: string): Promise<{ id: string; managed: ManagedSession }> {
  const book = currentBook;
  if (!book || book.id !== bookId) throw new Error("Book context changed before session creation");
  const id = randomUUID();
  const sessionDir = join(book.sessionsDir, bookId);
  const manager = SessionManager.create(process.cwd(), sessionDir, { id });
  const filePath = manager.getSessionFile();
  if (!filePath) throw new Error("Failed to determine session file path");
  const resourceLoader = makeResourceLoader();
  await resourceLoader.reload();
  const customTools = createBookTools(bookId, book.generation);
  const dir = agentDir;
  if (!dir) throw new Error("Agent directory not configured");
  const { session } = await createAgentSession({ sessionManager: manager, customTools, resourceLoader, agentDir: dir });
  const managed = { session, unsubscribe: subscribeSession(id, session), bookId, filePath, generation: book.generation };
  sessions.set(id, managed);
  return { id, managed };
}

async function loadSessionFromDisk(sessionId: string, bookId: string): Promise<ManagedSession | null> {
  const book = currentBook;
  if (!book || book.id !== bookId) return null;
  const sessionDir = join(book.sessionsDir, bookId);
  const infos = await SessionManager.list(process.cwd(), sessionDir);
  const info = infos.find((candidate) => candidate.id === sessionId);
  if (!info) return null;
  const manager = SessionManager.open(info.path, sessionDir);
  const resourceLoader = makeResourceLoader();
  await resourceLoader.reload();
  const customTools = createBookTools(bookId, book.generation);
  const dir = agentDir;
  if (!dir) throw new Error("Agent directory not configured");
  const { session } = await createAgentSession({ sessionManager: manager, customTools, resourceLoader, agentDir: dir });
  const managed = {
    session,
    unsubscribe: subscribeSession(sessionId, session),
    bookId,
    filePath: info.path,
    generation: book.generation,
  };
  sessions.set(sessionId, managed);
  return managed;
}

function disposeSessions(): void {
  for (const managed of sessions.values()) {
    managed.unsubscribe();
    managed.session.dispose();
  }
  sessions.clear();
  currentSessionId = null;
}

async function boundedAbort(session: AgentSession): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.abort().catch((error: unknown) => {
        process.stderr.write(`[session] abort failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, ABORT_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function abortActive(requestId?: string, requestedPromptId?: string): Promise<void> {
  const prompt = activePrompt;
  if (!prompt) {
    if (requestedPromptId) rememberCancelledPrompt(requestedPromptId);
    return;
  }
  if (requestedPromptId && requestedPromptId !== prompt.promptId) {
    rememberCancelledPrompt(requestedPromptId);
    return;
  }
  activePrompt = null;
  const managed = sessions.get(prompt.sessionId);
  if (managed) await boundedAbort(managed.session);
  sendEvent({
    type: "prompt_aborted",
    requestId,
    bookId: prompt.bookId,
    sessionId: prompt.sessionId,
    promptId: prompt.promptId,
  });
}

function rememberCancelledPrompt(promptId: string): void {
  cancelledPromptIds.add(promptId);
}

function consumeCancelledPrompt(promptId: string): boolean {
  return cancelledPromptIds.consume(promptId);
}

async function handleOpenBook(command: Extract<SidecarCommand, { type: "open_book" }>): Promise<void> {
  if (!agentDir) throw new Error("Agent directory not configured");
  const generation = bookLoadGate.begin(command.bookId);
  await abortActive(command.requestId);
  disposeSessions();
  const worker = bookWorkers.replace();
  currentBook = {
    id: command.bookId,
    path: command.path,
    sessionsDir: command.sessionsDir,
    generation,
    phase: "loading",
  };
  sendEvent({ type: "book_loading", requestId: command.requestId, bookId: command.bookId });
  void worker.load(command.path, command.bookId, generation).then(
    (result) => {
      if (!bookLoadGate.accepts(result.generation, command.bookId)) return;
      if (!currentBook || currentBook.generation !== result.generation) return;
      currentBook.phase = "ready";
      sendEvent({ type: "book_ready", requestId: command.requestId, bookId: command.bookId });
    },
    (error: unknown) => {
      if (!bookLoadGate.accepts(generation, command.bookId)) return;
      currentBook = null;
      sendError(
        "open_book",
        `Failed to load book: ${error instanceof Error ? error.message : String(error)}`,
        { requestId: command.requestId, bookId: command.bookId },
      );
    },
  );
}

async function handleCloseBook(command: Extract<SidecarCommand, { type: "close_book" }>): Promise<void> {
  if (command.bookId && currentBook?.id !== command.bookId) {
    throw new Error("Close command does not match the current book");
  }
  const closedBookId = currentBook?.id;
  bookLoadGate.clear();
  await abortActive(command.requestId);
  disposeSessions();
  currentBook = null;
  bookWorkers.clear();
  sendEvent({ type: "book_closed", requestId: command.requestId, bookId: closedBookId });
}

function requireCurrentBook(bookId: string, ready = true): CurrentBook {
  if (!currentBook || currentBook.id !== bookId) throw new Error("Command does not match the current book");
  if (ready && currentBook.phase !== "ready") throw new Error("Book is still loading");
  return currentBook;
}

function visibleBranchEntries(managed: ManagedSession) {
  const chronological = [...managed.session.sessionManager.getBranch()].reverse();
  return chronological.filter((entry) => {
    if (entry.type !== "message") return false;
    const role = entry.message.role;
    return role === "user" || role === "assistant";
  });
}

function isReadingContextParent(managed: ManagedSession, parentId: string | null): boolean {
  if (!parentId) return false;
  const parent = managed.session.sessionManager.getEntry(parentId);
  if (!parent) return false;
  return (parent.type === "custom_message" || parent.type === "custom")
    && parent.customType === "readingContext";
}

async function startPrompt(
  managed: ManagedSession,
  prompt: ActivePrompt,
  text: string,
  context: PromptContext | undefined,
): Promise<void> {
  activePrompt = prompt;
  sendEvent({ type: "prompt_started", ...prompt });
  if (!sessionHasBookSnapshot(managed.session.messages)) {
    try {
      const worker = requireBookWorker();
      const [meta, toc] = await Promise.all([
        worker.metadata(managed.bookId, managed.generation),
        worker.toc(managed.bookId, managed.generation),
      ]);
      await managed.session.sendCustomMessage(
        { customType: BOOK_SNAPSHOT_CUSTOM_TYPE, content: formatBookSnapshot(meta, toc), display: false, details: undefined },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
    } catch (error) {
      process.stderr.write(`[book-snapshot] failed to queue aside: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  if (context) {
    const asideParts: string[] = [];
    if (context.selection) asideParts.push(`用户选中的文本：\n"${context.selection}"`);
    else if (context.chapterIndex !== undefined) asideParts.push(`（当前在第 ${context.chapterIndex} 章）`);
    if (asideParts.length) {
      await managed.session.sendCustomMessage(
        { customType: "readingContext", content: asideParts.join("\n"), display: false, details: undefined },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
    }
  }
  void managed.session.prompt(text).then(
    () => {
      if (activePrompt !== prompt) return;
      activePrompt = null;
      sendEvent({
        type: "prompt_end",
        bookId: prompt.bookId,
        sessionId: prompt.sessionId,
        promptId: prompt.promptId,
      });
    },
    (error: unknown) => {
      if (activePrompt !== prompt) return;
      activePrompt = null;
      sendError(
        "prompt",
        error instanceof Error ? error.message : String(error),
        prompt,
      );
    },
  );
}

async function handlePrompt(command: Extract<SidecarCommand, { type: "prompt" }>): Promise<void> {
  requireCurrentBook(command.bookId);
  if (consumeCancelledPrompt(command.promptId)) {
    sendError("prompt", "Prompt was cancelled before it started", commandCorrelation(command));
    return;
  }
  if (activePrompt) throw new Error("Another prompt is already active");
  let sessionId = currentSessionId;
  let managed = sessionId ? sessions.get(sessionId) : undefined;
  if (!managed || managed.bookId !== command.bookId || managed.generation !== currentBook?.generation) {
    const created = await createSession(command.bookId);
    sessionId = created.id;
    managed = created.managed;
    currentSessionId = sessionId;
  }
  if (!sessionId || !managed) throw new Error("Failed to establish an active session");
  if (consumeCancelledPrompt(command.promptId)) {
    sendError("prompt", "Prompt was cancelled before it started", commandCorrelation(command));
    return;
  }
  await startPrompt(
    managed,
    {
      requestId: command.requestId,
      promptId: command.promptId,
      bookId: command.bookId,
      sessionId,
    },
    command.text,
    command.context,
  );
}

async function handleEditPrompt(command: Extract<SidecarCommand, { type: "edit_prompt" }>): Promise<void> {
  requireCurrentBook(command.bookId);
  if (consumeCancelledPrompt(command.promptId)) {
    sendError("edit_prompt", "Prompt was cancelled before it started", commandCorrelation(command));
    return;
  }
  if (activePrompt) throw new Error("Another prompt is already active");
  const sessionId = currentSessionId;
  const managed = sessionId ? sessions.get(sessionId) : undefined;
  if (!sessionId || !managed || managed.bookId !== command.bookId || managed.generation !== currentBook?.generation) {
    throw new Error("No active session for the current book");
  }
  const target = visibleBranchEntries(managed)[command.messageIndex];
  if (!target || target.type !== "message" || target.message.role !== "user") {
    throw new Error("Edit target must be a user message on the current branch");
  }
  const navigateId = isReadingContextParent(managed, target.parentId) && target.parentId
    ? target.parentId
    : target.id;
  const navigation = await managed.session.navigateTree(navigateId);
  if (navigation.cancelled) throw new Error("Session rewind was cancelled");
  sendEvent({
    type: "session_rewound",
    requestId: command.requestId,
    bookId: command.bookId,
    sessionId,
    promptId: command.promptId,
    messages: serializeMessages(managed.session.messages),
  });
  if (consumeCancelledPrompt(command.promptId)) {
    sendError("edit_prompt", "Prompt was cancelled before it started", commandCorrelation(command));
    return;
  }
  await startPrompt(
    managed,
    {
      requestId: command.requestId,
      promptId: command.promptId,
      bookId: command.bookId,
      sessionId,
    },
    command.text,
    command.context,
  );
}

async function handleNewSession(command: Extract<SidecarCommand, { type: "new_session" }>): Promise<void> {
  requireCurrentBook(command.bookId);
  await abortActive(command.requestId);
  const { id } = await createSession(command.bookId);
  currentSessionId = id;
  sendEvent({ type: "session_created", requestId: command.requestId, bookId: command.bookId, sessionId: id });
}

async function handleSwitchSession(command: Extract<SidecarCommand, { type: "switch_session" }>): Promise<void> {
  requireCurrentBook(command.bookId);
  await abortActive(command.requestId);
  let managed = sessions.get(command.sessionId);
  if (managed && managed.bookId !== command.bookId) managed = undefined;
  managed ??= await loadSessionFromDisk(command.sessionId, command.bookId) ?? undefined;
  if (!managed) throw new Error("Session not found for the current book");
  currentSessionId = command.sessionId;
  sendEvent({
    type: "session_switched",
    requestId: command.requestId,
    bookId: command.bookId,
    sessionId: command.sessionId,
    messages: serializeMessages(managed.session.messages),
  });
}

async function handleDeleteSession(command: Extract<SidecarCommand, { type: "delete_session" }>): Promise<void> {
  const book = requireCurrentBook(command.bookId);
  if (currentSessionId === command.sessionId) await abortActive(command.requestId);
  const managed = sessions.get(command.sessionId);
  if (managed && managed.bookId !== command.bookId) throw new Error("Session belongs to another book");
  if (managed) {
    await removeSessionFile(managed.filePath);
    managed.unsubscribe();
    managed.session.dispose();
    sessions.delete(command.sessionId);
  } else {
    const infos = await SessionManager.list(process.cwd(), join(book.sessionsDir, command.bookId));
    const target = infos.find((info) => info.id === command.sessionId);
    if (!target) throw new Error("Session not found for the current book");
    await removeSessionFile(target.path);
  }
  if (currentSessionId === command.sessionId) currentSessionId = null;
  sendEvent({
    type: "session_deleted",
    requestId: command.requestId,
    bookId: command.bookId,
    sessionId: command.sessionId,
  });
}

async function handleRenameSession(command: Extract<SidecarCommand, { type: "rename_session" }>): Promise<void> {
  requireCurrentBook(command.bookId);
  let managed = sessions.get(command.sessionId);
  if (managed && managed.bookId !== command.bookId) managed = undefined;
  managed ??= await loadSessionFromDisk(command.sessionId, command.bookId) ?? undefined;
  if (!managed) throw new Error("Session not found for the current book");
  managed.session.sessionManager.appendSessionInfo(command.title);
  sendEvent({
    type: "session_renamed",
    requestId: command.requestId,
    bookId: command.bookId,
    sessionId: command.sessionId,
    title: command.title,
  });
}

async function removeSessionFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function handleListSessions(command: Extract<SidecarCommand, { type: "list_sessions" }>): Promise<void> {
  const book = requireCurrentBook(command.bookId, false);
  const infos = await SessionManager.list(process.cwd(), join(book.sessionsDir, command.bookId));
  sendEvent({
    type: "sessions_list",
    requestId: command.requestId,
    bookId: command.bookId,
    sessions: infos.map((info) => ({
      id: info.id,
      title: deriveTitle(info.firstMessage, info.name),
      createdAt: info.created.toISOString(),
      updatedAt: info.modified.toISOString(),
    })),
  });
}

function deriveTitle(firstMessage: string, name?: string): string {
  if (name?.trim()) return name;
  if (firstMessage && firstMessage !== "(no messages)") return firstMessage.slice(0, 30);
  return "New Session";
}

function serializeMessages(messages: readonly unknown[]): SerializedMessage[] {
  const results = new Map<string, unknown>();
  for (const message of messages) {
    if (!message || typeof message !== "object" || (message as { role?: string }).role !== "toolResult") continue;
    const result = message as { toolCallId?: string; content?: { type?: string; text?: string }[] };
    if (!result.toolCallId || !Array.isArray(result.content)) continue;
    results.set(result.toolCallId, result.content.filter((item) => item.type === "text").map((item) => item.text ?? "").join(""));
  }
  const serialized: SerializedMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const role = (message as { role?: string }).role;
    if (role === "user") {
      const content = (message as { content?: unknown }).content;
      serialized.push({ role: "user", content: extractUserText(content) });
    } else if (role === "assistant") {
      const blocks = (message as { content?: unknown }).content;
      if (!Array.isArray(blocks)) continue;
      const text: string[] = [];
      const toolCalls: SerializedToolCall[] = [];
      for (const block of blocks) {
        if (!block || typeof block !== "object") continue;
        const typed = block as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
        if (typed.type === "text" && typed.text) text.push(typed.text);
        if (typed.type === "toolCall" && typed.id && typed.name) {
          toolCalls.push({
            toolCallId: typed.id,
            tool: typed.name,
            params: typed.arguments ?? {},
            result: results.get(typed.id),
            done: results.has(typed.id),
          });
        }
      }
      serialized.push({ role: "assistant", content: text.join(""), toolCalls: toolCalls.length ? toolCalls : undefined });
    }
  }
  return serialized;
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; text: string } => !!item && typeof item === "object"
      && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string")
    .map((item) => item.text)
    .join("");
}

async function handleConfigure(command: Extract<SidecarCommand, { type: "configure" }>): Promise<void> {
  agentDir = command.agentDir;
}

async function handleStateCommand(command: SidecarCommand): Promise<void> {
  switch (command.type) {
    case "configure":
      await handleConfigure(command);
      break;
    case "open_book":
      await handleOpenBook(command);
      break;
    case "close_book":
      await handleCloseBook(command);
      break;
    case "prompt":
      await handlePrompt(command);
      break;
    case "edit_prompt":
      await handleEditPrompt(command);
      break;
    case "list_sessions":
      await handleListSessions(command);
      break;
    case "new_session":
      await handleNewSession(command);
      break;
    case "switch_session":
      await handleSwitchSession(command);
      break;
    case "delete_session":
      await handleDeleteSession(command);
      break;
    case "rename_session":
      await handleRenameSession(command);
      break;
    case "ping":
    case "abort":
      break;
  }
}

async function shutdown(): Promise<void> {
  bookLoadGate.clear();
  await abortActive();
  disposeSessions();
  await bookWorkers.shutdown();
}

async function main(): Promise<void> {
  const startupWorker = bookWorkers.replace();
  await startupWorker.runFtsSmoke();
  ftsReady = true;
  const dispatcher = new SerialDispatcher((error) => {
    sendError("dispatcher", error instanceof Error ? error.message : String(error));
  });
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  process.stdin.resume();
  const keepAlive = setInterval(() => undefined, 60_000);

  input.on("line", (line) => {
    if (!line.trim()) return;
    let command: SidecarCommand;
    try {
      command = parseCommandLine(line);
    } catch (error) {
      sendError("protocol", error instanceof ProtocolDecodeError ? error.message : "Invalid command");
      return;
    }
    const run = async () => {
      try {
        await handleStateCommand(command);
      } catch (error) {
        sendError(
          command.type,
          error instanceof Error ? error.message : String(error),
          commandCorrelation(command),
        );
      }
    };
    if (command.type === "ping") {
      dispatcher.bypass(async () => {
        sendEvent({ type: "pong", requestId: command.requestId, fts5: ftsReady });
      });
    } else if (command.type === "abort") {
      dispatcher.bypass(async () => {
        try {
          await abortActive(command.requestId, command.promptId);
        } catch (error) {
          sendError("abort", error instanceof Error ? error.message : String(error), commandCorrelation(command));
        }
      });
    } else if (!dispatcher.enqueue(run)) {
      sendError(command.type, "Sidecar command queue is full", commandCorrelation(command));
    }
  });

  input.once("close", () => {
    clearInterval(keepAlive);
    void dispatcher.idle().then(shutdown).finally(() => process.exit(0));
  });
  sendEvent({ type: "ready" });
}

if (isBookWorkerThread()) {
  runBookWorker();
} else {
  void main().catch((error) => {
    sendError("startup", error instanceof Error ? error.message : String(error), {}, false);
    process.exitCode = 1;
  });
}
