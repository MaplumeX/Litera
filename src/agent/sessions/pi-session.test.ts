import { describe, expect, it } from "vitest";
import { activeBranch, convertPiContextToLlm, decodePiSession, piContextMessages, visibleMessages, windowCompleteTurns } from "./pi-session";

const timestamp = "2026-08-14T00:00:00Z";
const entry = (id: string, parentId: string | null, role: "user" | "assistant", text: string) => ({ type: "message", id, parentId, timestamp, message: { role, content: [{ type: "text", text }], timestamp: 1 } });

describe("Pi session decoder", () => {
  it("follows the active branch and excludes alternate history", () => {
    const session = decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [entry("a", null, "user", "old"), entry("b", "a", "assistant", "old answer"), entry("c", null, "user", "edited")], leafId: "c" });
    expect(activeBranch(session).map((item) => item.id)).toEqual(["c"]);
    expect(visibleMessages(session)).toEqual([{ role: "user", content: "edited", toolCalls: undefined }]);
  });
  it("uses the latest compaction boundary", () => {
    const session = decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [entry("a", null, "user", "one"), entry("b", "a", "assistant", "two"), { type: "compaction", id: "c", parentId: "b", timestamp, summary: "sum", firstKeptEntryId: "b" }, entry("d", "c", "user", "three")], leafId: "d" });
    expect(activeBranch(session).map((item) => item.id)).toEqual(["c", "b", "d"]);
    const context = piContextMessages(session);
    expect((context[0] as unknown as { role: string }).role).toBe("compactionSummary");
    expect(convertPiContextToLlm(context)[0]).toMatchObject({ role: "user", content: [{ text: expect.stringContaining("sum") }] });
  });
  it("keeps only the requested number of complete recent turns", () => {
    const messages = [{ role: "user" }, { role: "assistant" }, { role: "toolResult" }, { role: "user" }, { role: "assistant" }] as never[];
    expect(windowCompleteTurns(messages, 1)).toHaveLength(2);
  });
  it("retains the book snapshot outside the recent turn window", () => {
    const messages = [
      { role: "custom", customType: "bookSnapshot" },
      { role: "user" }, { role: "assistant" },
      { role: "user" }, { role: "assistant" },
    ] as never[];
    expect(windowCompleteTurns(messages, 1).map((message) => (message as unknown as { role: string }).role)).toEqual(["custom", "user", "assistant"]);
  });
  it("copies toolResult isError onto the visible tool call", () => {
    const session = decodePiSession({
      header: { type: "session", version: 3, id: "s", timestamp, cwd: "" },
      entries: [
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
      ],
      leafId: "b",
    });
    expect(visibleMessages(session)[0].toolCalls?.[0]).toMatchObject({
      toolCallId: "c1",
      result: "[]",
      isError: true,
    });
  });
  it("normalizes legacy null content and rejects malformed known messages", () => {
    const normalized = decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [{ type: "message", id: "a", parentId: null, timestamp, message: { role: "assistant", content: null } }], leafId: "a" });
    expect((normalized.entries[0].message as { content: unknown }).content).toEqual([]);
    expect(() => decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [{ type: "message", id: "a", parentId: null, timestamp, message: { role: "toolResult", content: [], toolCallId: "call" } }], leafId: "a" })).toThrow("Invalid Pi tool result");
  });
});
