import { invoke } from "@tauri-apps/api/core";
import type { AgentSessionSummary } from "@/types/agent";
import {
  decodePiSession,
  sessionSummary,
  type DecodedPiSession,
  type PiSessionEntry,
} from "./pi-session";

export interface SessionPort {
  create(bookId: string): Promise<DecodedPiSession>;
  list(bookId: string): Promise<AgentSessionSummary[]>;
  load(bookId: string, sessionId: string): Promise<DecodedPiSession>;
  append(bookId: string, sessionId: string, expectedLeafId: string | null, entries: PiSessionEntry[]): Promise<string | null>;
  delete(bookId: string, sessionId: string): Promise<void>;
}

export const tauriSessionPort: SessionPort = {
  async create(bookId) { return decodePiSession(await invoke("create_agent_session", { bookId })); },
  async list(bookId) {
    const result = await invoke<unknown>("list_agent_sessions", { bookId });
    if (!Array.isArray(result)) throw new Error("Invalid session list");
    return result.map(sessionSummary);
  },
  async load(bookId, sessionId) { return decodePiSession(await invoke("load_agent_session", { bookId, sessionId })); },
  append(bookId, sessionId, expectedLeafId, entries) {
    return invoke<string | null>("append_agent_session_entries", { bookId, sessionId, expectedLeafId, entries });
  },
  delete(bookId, sessionId) { return invoke("delete_agent_session", { bookId, sessionId }); },
};

