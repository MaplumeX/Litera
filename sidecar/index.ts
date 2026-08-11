/**
 * Litera pi agent sidecar
 *
 * stdio JSON lines protocol:
 *   stdin  → { type: "prompt", text: string } | { type: "abort" }
 *   stdout → { type: "text_delta", delta } | { type: "tool_start", tool, params }
 *          | { type: "tool_end", result } | { type: "agent_end" }
 *          | { type: "error", message }
 */

import * as readline from "node:readline";
import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

// --- stdio helpers -----------------------------------------------------------

/** Write a JSON line to stdout (protocol output only — never use console.log). */
function sendMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendError(message: string): void {
  sendMessage({ type: "error", message });
}

// --- Agent session lifecycle -------------------------------------------------

let session: AgentSession | null = null;
let unsubscribe: (() => void) | null = null;

async function initSession(): Promise<void> {
  const { session: s } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    // Minimal: no tools for base conversation layer (Child 4 adds book tools)
    noTools: "all",
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

// --- stdin protocol handling -------------------------------------------------

async function handlePrompt(text: string): Promise<void> {
  if (!session) {
    sendError("Agent session not initialized");
    return;
  }
  try {
    await session.prompt(text);
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  }
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

    // Narrow to a record with a type field
    const typed = msg as Record<string, unknown>;
    if (typeof typed.type !== "string") {
      sendError("Missing 'type' field in input");
      return;
    }

    switch (typed.type) {
      case "prompt":
        if (typeof typed.text !== "string") {
          sendError("Prompt requires a 'text' string field");
          return;
        }
        void handlePrompt(typed.text);
        break;

      case "abort":
        void handleAbort();
        break;

      default:
        sendError(`Unknown message type: ${typed.type}`);
    }
  });

  // Clean shutdown
  rl.on("close", () => {
    if (unsubscribe) unsubscribe();
    if (session) session.dispose();
    process.exit(0);
  });

  // Signal that sidecar is ready
  sendMessage({ type: "ready" });
}

void main();