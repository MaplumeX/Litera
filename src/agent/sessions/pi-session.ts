import type { AgentMessage as PiAgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentMessage as UiAgentMessage, AgentSessionSummary } from "@/types/agent";

export interface PiSessionHeader {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
}

export interface PiSessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface DecodedPiSession {
  header: PiSessionHeader;
  entries: PiSessionEntry[];
  leafId: string | null;
}

export interface PiSessionPayload {
  header: unknown;
  entries: unknown;
  leafId?: unknown;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function validContent(content: unknown, role: string): boolean {
  if (role === "user" && typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.every((part) => {
    const block = object(part);
    if (!block || typeof block.type !== "string") return false;
    if (block.type === "text") return typeof block.text === "string";
    if (block.type === "image") return typeof block.data === "string" && typeof block.mimeType === "string";
    if (role === "assistant" && block.type === "thinking") return typeof block.thinking === "string";
    if (role === "assistant" && block.type === "toolCall") {
      return !!string(block.id) && !!string(block.name) && !!object(block.arguments);
    }
    return false;
  });
}

function decodeMessage(value: unknown): Record<string, unknown> {
  const message = object(value);
  const role = string(message?.role);
  if (!message || !role) throw new Error("Invalid Pi session message");
  if (role !== "user" && role !== "assistant" && role !== "toolResult") return message;
  const content = message.content == null ? [] : message.content;
  if (!validContent(content, role)) throw new Error("Invalid Pi session message content");
  if (role === "toolResult" && (!string(message.toolCallId) || !string(message.toolName) || typeof message.isError !== "boolean")) {
    throw new Error("Invalid Pi tool result");
  }
  return { ...message, content };
}

export function decodePiSession(value: unknown): DecodedPiSession {
  const payload = object(value);
  const rawHeader = object(payload?.header);
  if (!payload || !rawHeader || rawHeader.type !== "session" || rawHeader.version !== 3) {
    throw new Error("Unsupported Pi session payload");
  }
  const id = string(rawHeader.id);
  const timestamp = string(rawHeader.timestamp);
  if (!id || !timestamp || typeof rawHeader.cwd !== "string" || !Array.isArray(payload.entries)) {
    throw new Error("Invalid Pi session header");
  }
  const entries: PiSessionEntry[] = [];
  const ids = new Set<string>();
  for (const raw of payload.entries) {
    const entry = object(raw);
    const entryId = string(entry?.id);
    const type = string(entry?.type);
    const entryTimestamp = string(entry?.timestamp);
    const parentId = entry?.parentId;
    if (!entry || !entryId || !type || !entryTimestamp || (parentId !== null && typeof parentId !== "string")) {
      throw new Error("Invalid Pi session entry");
    }
    if (ids.has(entryId) || (typeof parentId === "string" && !ids.has(parentId))) {
      throw new Error("Invalid Pi session tree");
    }
    ids.add(entryId);
    const normalized: PiSessionEntry = { ...entry, type, id: entryId, parentId, timestamp: entryTimestamp };
    if (type === "message") normalized.message = decodeMessage(entry.message);
    if (type === "custom_message" && !string(entry.customType)) throw new Error("Invalid Pi custom message");
    entries.push(normalized);
  }
  const leafId = payload.leafId == null ? null : string(payload.leafId);
  if (leafId && !ids.has(leafId)) throw new Error("Invalid Pi session leaf");
  return {
    header: { type: "session", version: 3, id, timestamp, cwd: rawHeader.cwd },
    entries,
    leafId,
  };
}

export function activeBranch(session: DecodedPiSession): PiSessionEntry[] {
  const byId = new Map(session.entries.map((entry) => [entry.id, entry]));
  let current = session.leafId ? byId.get(session.leafId) : session.entries[session.entries.length - 1];
  const path: PiSessionEntry[] = [];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  let latestCompaction: PiSessionEntry | undefined;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (path[index].type === "compaction") { latestCompaction = path[index]; break; }
  }
  if (!latestCompaction) return path;
  const compactIndex = path.indexOf(latestCompaction);
  const firstKeptId = string(latestCompaction.firstKeptEntryId);
  const keptIndex = firstKeptId ? path.findIndex((entry) => entry.id === firstKeptId) : -1;
  return [latestCompaction, ...(keptIndex >= 0 ? path.slice(keptIndex, compactIndex) : []), ...path.slice(compactIndex + 1)];
}

export function piContextMessages(session: DecodedPiSession): PiAgentMessage[] {
  return activeBranch(session).flatMap((entry): PiAgentMessage[] => {
    if (entry.type === "message" && object(entry.message)) return [entry.message as PiAgentMessage];
    if (entry.type === "custom_message") {
      return [{
        role: "custom",
        customType: typeof entry.customType === "string" ? entry.customType : "litera",
        content: entry.content ?? [],
        display: entry.display === true,
        details: entry.details,
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    if (entry.type === "branch_summary" && typeof entry.summary === "string") {
      return [{
        role: "branchSummary",
        summary: entry.summary,
        fromId: typeof entry.fromId === "string" ? entry.fromId : "",
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    if (entry.type === "compaction" && typeof entry.summary === "string") {
      return [{
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: typeof entry.tokensBefore === "number" ? entry.tokensBefore : 0,
        timestamp: Date.parse(entry.timestamp),
      } as PiAgentMessage];
    }
    return [];
  });
}

export function convertPiContextToLlm(messages: PiAgentMessage[]): Message[] {
  return messages.flatMap((message): Message[] => {
    const custom = message as unknown as Record<string, unknown>;
    if (message.role === "user" || message.role === "assistant" || message.role === "toolResult") {
      return [message];
    }
    const timestamp = typeof custom.timestamp === "number" ? custom.timestamp : Date.now();
    if (custom.role === "custom") {
      const content = typeof custom.content === "string"
        ? [{ type: "text" as const, text: custom.content }]
        : Array.isArray(custom.content) ? custom.content : [];
      return [{ role: "user", content, timestamp } as Message];
    }
    if (custom.role === "compactionSummary" && typeof custom.summary === "string") {
      return [{ role: "user", content: [{ type: "text", text: `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${custom.summary}\n</summary>` }], timestamp }];
    }
    if (custom.role === "branchSummary" && typeof custom.summary === "string") {
      return [{ role: "user", content: [{ type: "text", text: `The following is a summary of a branch that this conversation came back from:\n\n<summary>\n${custom.summary}\n</summary>` }], timestamp }];
    }
    return [];
  });
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => {
    const block = object(part);
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
  }).join("");
}

export function visibleMessages(session: DecodedPiSession): UiAgentMessage[] {
  const output: UiAgentMessage[] = [];
  const toolOwners = new Map<string, { messageIndex: number; callIndex: number }>();
  for (const entry of activeBranch(session)) {
    if (entry.type !== "message") continue;
    const message = object(entry.message);
    if (!message) continue;
    if (message.role === "toolResult" && typeof message.toolCallId === "string") {
      const owner = toolOwners.get(message.toolCallId);
      if (owner) {
        const call = output[owner.messageIndex].toolCalls?.[owner.callIndex];
        if (call) {
          call.result = contentText(message.content);
          if (message.isError === true) call.isError = true;
        }
      }
      continue;
    }
    if (message.role !== "user" && message.role !== "assistant") continue;
    const toolCalls = message.role === "assistant" && Array.isArray(message.content)
      ? message.content.flatMap((part) => {
          const block = object(part);
          return block?.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string"
            ? [{ toolCallId: block.id, tool: block.name, params: block.arguments, done: true }]
            : [];
        })
      : undefined;
    output.push({ role: message.role, content: contentText(message.content), toolCalls });
    toolCalls?.forEach((call, callIndex) => toolOwners.set(call.toolCallId, { messageIndex: output.length - 1, callIndex }));
  }
  return output;
}

export function windowCompleteTurns(messages: PiAgentMessage[], maxTurns = 12): PiAgentMessage[] {
  let userTurns = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") userTurns += 1;
    start = index;
    if (userTurns >= maxTurns) break;
  }
  const window = messages.slice(start);
  let snapshot: PiAgentMessage | undefined;
  for (let index = start - 1; index >= 0; index -= 1) {
    const candidate = messages[index] as unknown as Record<string, unknown>;
    if (candidate.role === "custom" && candidate.customType === "bookSnapshot") {
      snapshot = messages[index];
      break;
    }
  }
  return snapshot ? [snapshot, ...window] : window;
}

export interface SessionConfig {
  systemPrompt: string;
}

/**
 * Latest session_config entry on the active branch, or null when the session
 * has none. Absent systemPrompt -> "" (empty string means unset -> default
 * SYSTEM_PROMPT at runtime).
 */
export function sessionConfig(session: DecodedPiSession): SessionConfig | null {
  const branch = activeBranch(session);
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "session_config") continue;
    return {
      systemPrompt: string(entry.systemPrompt) ?? "",
    };
  }
  return null;
}

export function sessionSummary(value: unknown): AgentSessionSummary {
  const item = object(value);
  if (!item || !string(item.id) || typeof item.title !== "string" || !string(item.createdAt) || !string(item.updatedAt)) {
    throw new Error("Invalid session summary");
  }
  const summary: AgentSessionSummary = { id: item.id as string, title: item.title, createdAt: item.createdAt as string, updatedAt: item.updatedAt as string };
  const systemPrompt = string(item.systemPrompt);
  if (systemPrompt !== null) summary.systemPrompt = systemPrompt;
  return summary;
}

export function newEntry(type: string, parentId: string | null, fields: Record<string, unknown>): PiSessionEntry {
  return { type, id: crypto.randomUUID(), parentId, timestamp: new Date().toISOString(), ...fields };
}
