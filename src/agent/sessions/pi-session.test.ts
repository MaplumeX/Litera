import { describe, expect, it } from "vitest";
import { activeBranch, branchLeafId, branchNavigation, convertPiContextToLlm, decodePiSession, piContextMessages, sessionConfig, sessionSummary, visibleMessageEntries, visibleMessages } from "./pi-session";

const timestamp = "2026-08-14T00:00:00Z";
const ts = (n: number) => new Date(Date.parse(timestamp) + n * 1000).toISOString();
const entry = (id: string, parentId: string | null, role: "user" | "assistant", text: string, time?: number) => ({ type: "message", id, parentId, timestamp: time === undefined ? timestamp : ts(time), message: { role, content: [{ type: "text", text }], timestamp: 1 } });
const configEntry = (id: string, parentId: string | null, fields: Record<string, unknown>) => ({ type: "session_config", id, parentId, timestamp, ...fields });
const makeSession = (entries: unknown[], leafId: string) => decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries, leafId });

// Fork fixture helper: the edit flow repoints leafId to the edited
// message's parent, so the new first user message hangs below the same
// ancestor as the edited one (the session root for the first turn).
const fork = (id: string, parentId: string | null, text: string, time = 0) => ({ type: "message", id, parentId, timestamp: ts(time), message: { role: "user" as const, content: [{ type: "text", text }], timestamp: 1 } });

describe("branchNavigation", () => {
  it("returns an empty map for a single-line session without forks", () => {
    const session = makeSession([
      entry("u1", null, "user", "first question"),
      entry("a1", "u1", "assistant", "answer"),
      entry("u2", "a1", "user", "second question"),
      entry("a2", "u2", "assistant", "answer two"),
    ], "a2");
    expect(branchNavigation(session).size).toBe(0);
  });

  it("exposes both anchors after one edit, with activeIndex on the new branch", () => {
    const session = makeSession([
      entry("u1", null, "user", "original question"),
      entry("a1", "u1", "assistant", "old answer"),
      fork("u1b", null, "edited question", 10),
    ], "u1b");
    const nav = branchNavigation(session);
    expect([...nav.keys()].sort()).toEqual(["u1", "u1b"]);
    const info = nav.get("u1")!;
    expect(nav.get("u1b")).toBe(info);
    expect(info.options.map((option) => option.anchorId)).toEqual(["u1", "u1b"]);
    expect(info.options.map((option) => option.preview)).toEqual(["original question", "edited question"]);
    expect(info.activeIndex).toBe(1);
    // The same tree with the leaf on the old branch reports the old index.
    const oldBranch = branchNavigation(makeSession(session.entries, "a1"));
    expect(oldBranch.get("u1")!.activeIndex).toBe(0);
  });

  it("handles a mid-conversation fork (editIndex 2)", () => {
    const session = makeSession([
      entry("u1", null, "user", "q1"),
      entry("a1", "u1", "assistant", "a1 answer"),
      entry("u2", "a1", "user", "q2"),
      entry("a2", "u2", "assistant", "a2 answer"),
      fork("u2b", "a1", "edited q2", 20),
    ], "u2b");
    const nav = branchNavigation(session);
    expect(nav.size).toBe(2);
    const info = nav.get("u2")!;
    expect(nav.get("u2b")).toBe(info);
    expect(info.options.map((option) => option.anchorId)).toEqual(["u2", "u2b"]);
    expect(info.activeIndex).toBe(1);
    // Earlier turns are untouched.
    expect(nav.has("u1")).toBe(false);
  });

  it("orders options by first-user-message timestamp after two edits", () => {
    const session = makeSession([
      entry("u1", null, "user", "first"),
      entry("a1", "u1", "assistant", "answer one"),
      fork("u1c", null, "third branch", 30),
      fork("u1b", null, "second branch", 20),
    ], "u1b");
    const info = branchNavigation(session).get("u1")!;
    expect(info.options.map((option) => option.anchorId)).toEqual(["u1", "u1b", "u1c"]);
    expect(info.activeIndex).toBe(1);
  });

  it("orders a three-branch fork by timestamp and tracks the active branch", () => {
    const session = makeSession([
      entry("u1", null, "user", "original"),
      entry("a1", "u1", "assistant", "old answer"),
      fork("u1b", null, "second try", 10),
      fork("u1c", null, "third try", 20),
    ], "u1c");
    const info = branchNavigation(session).get("u1")!;
    expect(info.options).toHaveLength(3);
    expect(info.options.map((option) => option.anchorId)).toEqual(["u1", "u1b", "u1c"]);
    expect(info.activeIndex).toBe(2);
  });

  it("keeps independent forks independent", () => {
    const session = makeSession([
      entry("u1", null, "user", "q1"),
      entry("a1", "u1", "assistant", "a1"),
      entry("u2", "a1", "user", "q2"),
      entry("a2", "u2", "assistant", "a2"),
      fork("u2b", "a1", "edited q2", 10),
      fork("u1b", null, "edited q1", 20),
    ], "u1b");
    const nav = branchNavigation(session);
    expect(nav.size).toBe(4);
    const turnOne = nav.get("u1")!;
    expect(turnOne.options.map((option) => option.anchorId)).toEqual(["u1", "u1b"]);
    expect(turnOne.activeIndex).toBe(1);
    const turnTwo = nav.get("u2")!;
    expect(turnTwo.options.map((option) => option.anchorId)).toEqual(["u2", "u2b"]);
    // The active leaf is on the turn-one fork, so turn two's fork has no
    // active member: -1 fallback (its anchors are not visible at all).
    expect(turnTwo.activeIndex).toBe(-1);
  });

  it("resolves the active index through the true leaf path when compaction rewires activeBranch", () => {
    const session = makeSession([
      entry("u1", null, "user", "q1"),
      entry("a1", "u1", "assistant", "a1"),
      { type: "compaction", id: "cmp", parentId: "a1", timestamp: ts(5), summary: "sum", firstKeptEntryId: "a1" },
      entry("u2", "cmp", "user", "q2"),
      entry("a2", "u2", "assistant", "a2"),
      fork("u2b", "cmp", "edited q2", 10),
    ], "u2b");
    const nav = branchNavigation(session);
    expect(activeBranch(session).map((item) => item.id)).toEqual(["cmp", "a1", "u2b"]);
    const info = nav.get("u2")!;
    expect(info.options.map((option) => option.anchorId)).toEqual(["u2", "u2b"]);
    expect(info.activeIndex).toBe(1);
  });

  it("truncates long branch previews", () => {
    const long = "这是一个非常非常长的用户消息内容，用来验证分支预览会被截断处理，避免在切换器界面中溢出显示不完。";
    const session = makeSession([
      entry("u1", null, "user", long),
      entry("a1", "u1", "assistant", "ok"),
      fork("u1b", null, long, 10),
    ], "u1b");
    const info = branchNavigation(session).get("u1")!;
    expect(info.options[0].preview.length).toBeLessThanOrEqual(41);
    expect(info.options[0].preview.endsWith("…")).toBe(true);
  });
});

describe("branchLeafId", () => {
  it("returns the entry id when the anchor has no children", () => {
    const session = makeSession([entry("u1", null, "user", "q")], "u1");
    expect(branchLeafId(session, "u1")).toBe("u1");
  });

  it("walks a linear chain to the deepest leaf", () => {
    const session = makeSession([
      entry("u1", null, "user", "q"),
      entry("a1", "u1", "assistant", "a"),
      entry("u2", "a1", "user", "q2"),
      entry("a2", "u2", "assistant", "a2"),
    ], "a2");
    expect(branchLeafId(session, "u1")).toBe("a2");
    expect(branchLeafId(session, "u2")).toBe("a2");
    expect(branchLeafId(session, "a1")).toBe("a2");
  });

  it("follows the latest-timestamp child at a fork", () => {
    const session = makeSession([
      entry("u1", null, "user", "q"),
      entry("a1", "u1", "assistant", "answer", 1),
      entry("u2", "a1", "user", "old follow-up", 2),
      entry("a2", "u2", "assistant", "old branch end", 3),
      fork("u2b", "a1", "edited follow-up", 10),
      entry("a2b", "u2b", "assistant", "new branch end", 11),
    ], "a2b");
    // Fork below a1: children are u2 (t2) and u2b (t10) -> follow u2b.
    expect(branchLeafId(session, "u1")).toBe("a2b");
    expect(branchLeafId(session, "a1")).toBe("a2b");
    // Each sibling branch's own walk stays on its own subtree.
    expect(branchLeafId(session, "u2")).toBe("a2");
    expect(branchLeafId(session, "u2b")).toBe("a2b");
  });

  it("returns null for an unknown anchor", () => {
    const session = makeSession([entry("u1", null, "user", "q")], "u1");
    expect(branchLeafId(session, "missing")).toBeNull();
  });
});

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

describe("visibleMessageEntries", () => {
  it("stays in lockstep with visibleMessages for tool rounds and consecutive assistant entries", () => {
    const session = makeSession([
      entry("u1", null, "user", "first question"),
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "search_in_book", arguments: { queries: ["x"] } }],
          timestamp: 1,
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp,
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "search_in_book",
          content: [{ type: "text", text: "[]" }],
          isError: false,
          timestamp: 2,
        },
      },
      entry("a2", "r1", "assistant", "looked up"),
      entry("u2", "a2", "user", "second question"),
      entry("a3", "u2", "assistant", "second answer"),
    ], "a3");
    const anchors = visibleMessageEntries(session);
    const visible = visibleMessages(session);
    // One anchor per UI bubble: the tool round merges into a single assistant
    // bubble anchored at the run's first assistant entry (a1).
    expect(anchors.map((anchor) => anchor.id)).toEqual(["u1", "a1", "u2", "a3"]);
    expect(anchors).toHaveLength(visible.length);
    expect(anchors.map((anchor) => (anchor.message as { role: string }).role)).toEqual(visible.map((message) => message.role));
  });
  it("returns an empty anchor list for a rewound-to-root session", () => {
    const session = makeSession([entry("u1", null, "user", "q"), entry("a1", "u1", "assistant", "a")], "a1");
    expect(activeBranch({ ...session, leafId: null })).toEqual([]);
    expect(visibleMessageEntries({ ...session, leafId: null })).toEqual([]);
    expect(visibleMessages({ ...session, leafId: null })).toEqual([]);
  });
});

describe("Pi session decoder", () => {
  it("follows the active branch and excludes alternate history", () => {
    const session = decodePiSession({ header: { type: "session", version: 3, id: "s", timestamp, cwd: "" }, entries: [entry("a", null, "user", "old"), entry("b", "a", "assistant", "old answer"), entry("c", null, "user", "edited")], leafId: "c" });
    expect(activeBranch(session).map((item) => item.id)).toEqual(["c"]);
    expect(visibleMessages(session)).toEqual([{ role: "user", content: "edited" }]);
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
    expect(visibleMessages(session)[0].blocks?.[0]).toMatchObject({
      type: "toolCall",
      toolCall: {
        toolCallId: "c1",
        result: "[]",
        isError: true,
      },
    });
  });
  it("rebuilds ordered blocks including thinking and merges consecutive assistant entries", () => {
    const session = makeSession([
      entry("u", null, "user", "question"),
      {
        type: "message",
        id: "a1",
        parentId: "u",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "先想" },
            { type: "text", text: "我查一下" },
            { type: "toolCall", id: "c1", name: "search_in_book", arguments: { queries: ["x"] } },
          ],
          timestamp: 1,
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp,
        message: {
          role: "toolResult",
          toolCallId: "c1",
          toolName: "search_in_book",
          content: [{ type: "text", text: "[]" }],
          isError: false,
          timestamp: 2,
        },
      },
      {
        type: "message",
        id: "a2",
        parentId: "r1",
        timestamp,
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "再看" },
            { type: "text", text: "结论" },
          ],
          timestamp: 3,
        },
      },
    ], "a2");
    expect(visibleMessages(session)).toEqual([
      { role: "user", content: "question" },
      {
        role: "assistant",
        content: "我查一下结论",
        blocks: [
          { type: "thinking", text: "先想" },
          { type: "text", text: "我查一下" },
          {
            type: "toolCall",
            toolCall: {
              toolCallId: "c1",
              tool: "search_in_book",
              params: { queries: ["x"] },
              result: "[]",
              done: true,
            },
          },
          { type: "thinking", text: "再看" },
          { type: "text", text: "结论" },
        ],
      },
    ]);
  });
  it("does not merge assistant entries across a user message", () => {
    const session = makeSession([
      entry("a1", null, "assistant", "first"),
      entry("u", "a1", "user", "again"),
      entry("a2", "u", "assistant", "second"),
    ], "a2");
    expect(visibleMessages(session).map((message) => message.content)).toEqual(["first", "again", "second"]);
  });
  it("normalizes legacy null content and rejects malformed known messages", () => {
    const normalized = makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "assistant", content: null } }], "a");
    expect((normalized.entries[0].message as { content: unknown }).content).toEqual([]);
    expect(() => makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "toolResult", content: [], toolCallId: "call" } }], "a")).toThrow("Invalid Pi tool result");
  });
});
