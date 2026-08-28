import { describe, expect, it } from "vitest";
import { activeBranch, convertPiContextToLlm, decodePiSession, piContextMessages, sessionConfig, sessionSummary, visibleMessages } from "./pi-session";

const timestamp = "2026-08-14T00:00:00Z";
const entry = (id: string, parentId: string | null, role: "user" | "assistant", text: string) => ({ type: "message", id, parentId, timestamp, message: { role, content: [{ type: "text", text }], timestamp: 1 } });
const configEntry = (id: string, parentId: string | null, fields: Record<string, unknown>) => ({ type: "session_config", id, parentId, timestamp, ...fields });
const makeSession = (entries: unknown[], leafId: string) => decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries, leafId });

describe("sessionConfig", () => {
  it("returns the latest session_config entry on the active branch", () => {
    expect(sessionConfig(makeSession([configEntry("c1", null, { systemPrompt: "旧提示词", thinkingLevel: "max" }), configEntry("c2", "c1", { systemPrompt: "翻译为古文" })], "c2")))
      .toEqual({ systemPrompt: "翻译为古文" });
  });
  it("ignores config entries on branches the active leaf is not on", () => {
    // Fork: c1 -> alt (forked away) vs c1 -> main (active). The active branch
    // carries no session_config, so the forked-away config must not leak in.
    expect(sessionConfig(makeSession([
      configEntry("c1", null, { systemPrompt: "主线", thinkingLevel: "low" }),
      configEntry("alt", "c1", { systemPrompt: "分支", thinkingLevel: "high" }),
      entry("m", "c1", "user", "hello"),
    ], "m"))).toEqual({ systemPrompt: "主线" });
  });
  it("falls back per field: empty systemPrompt -> \"\"", () => {
    expect(sessionConfig(makeSession([
      configEntry("c1", null, { systemPrompt: "", thinkingLevel: "xhigh" }),
      configEntry("c2", "c1", { systemPrompt: "keep" }),
    ], "c2"))).toEqual({ systemPrompt: "keep" });
    expect(sessionConfig(makeSession([configEntry("c1", null, {})], "c1"))).toEqual({ systemPrompt: "" });
  });
  it("returns null when the session has no session_config entry", () => {
    expect(sessionConfig(makeSession([entry("a", null, "user", "hi")], "a"))).toBeNull();
  });
});

describe("sessionSummary", () => {
  it("passes through systemPrompt when present", () => {
    expect(sessionSummary({ id: "s", title: "t", createdAt: timestamp, updatedAt: timestamp, systemPrompt: "p", thinkingLevel: "max" }))
      .toEqual({ id: "s", title: "t", createdAt: timestamp, updatedAt: timestamp, systemPrompt: "p" });
  });
  it("omits null or non-string config fields", () => {
    expect(sessionSummary({ id: "s", title: "t", createdAt: timestamp, updatedAt: timestamp, systemPrompt: null, thinkingLevel: 3 }))
      .toEqual({ id: "s", title: "t", createdAt: timestamp, updatedAt: timestamp });
  });
});

describe("Pi session decoder", () => {
  it("follows the active branch and excludes alternate history", () => {
    const session = decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [entry("a", null, "user", "old"), entry("b", "a", "assistant", "old answer"), entry("c", null, "user", "edited")], leafId: "c" });
    expect(activeBranch(session).map((item) => item.id)).toEqual(["c"]);
    expect(visibleMessages(session)).toEqual([{ role: "user", content: "edited", toolCalls: undefined }]);
  });
  it("uses the latest compaction boundary", () => {
    const session = makeSession([entry("a", null, "user", "one"), entry("b", "a", "assistant", "two"), { type: "compaction", id: "c", parentId: "b", timestamp, summary: "sum", firstKeptEntryId: "b" }, entry("d", "c", "user", "three")], "d");
    expect(activeBranch(session).map((item) => item.id)).toEqual(["c", "b", "d"]);
    const context = piContextMessages(session);
    expect((context[0] as unknown as { role: string }).role).toBe("compactionSummary");
    expect(convertPiContextToLlm(context)[0]).toMatchObject({ role: "user", content: [{ text: expect.stringContaining("sum") }] });
  });
  it("copies toolResult isError onto the visible tool call", () => {
    const session = makeSession([
      {
        type: "message",
        id: "a",
        parentId: null,
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "search_in_book", arguments: { queries: ["x"] } }],
          timestamp: 1,
        },
      },
      {
        type: "message",
        id: "b",
        parentId: "a",
        timestamp,
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "search_in_book",
          content: [{ type: "text", text: "[]" }],
          isError: true,
          timestamp: 2,
        },
      },
    ], "b");
    expect(visibleMessages(session)[0].toolCalls?.[0]).toMatchObject({
      toolCallId: "c1",
      result: "[]",
      isError: true,
    });
  });
  it("normalizes legacy null content and rejects malformed known messages", () => {
    const normalized = makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "assistant", content: null } }], "a");
    expect((normalized.entries[0].message as { content: unknown }).content).toEqual([]);
    expect(() => makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "toolResult", content: [], toolCallId: "call" } }], "a")).toThrow("Invalid Pi tool result");
  });
});
