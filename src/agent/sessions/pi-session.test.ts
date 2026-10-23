import { describe, expect, it } from "vitest";
import { activeBranch, branchLeafId, branchNavigation, contextBranch, convertPiContextToLlm, decodeGuide, decodePiSession, guideCursor, piContextMessages, sessionConfig, sessionSummary, visibleMessageEntries, visibleMessages } from "./pi-session";
import type { PiSessionEntry } from "./pi-session";

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

  it("resolves the active index against the full branch when a compaction is present", () => {
    const session = makeSession([
      entry("u1", null, "user", "q1"),
      entry("a1", "u1", "assistant", "a1"),
      { type: "compaction", id: "cmp", parentId: "a1", timestamp: ts(5), summary: "sum", firstKeptEntryId: "a1" },
      entry("u2", "cmp", "user", "q2"),
      entry("a2", "u2", "assistant", "a2"),
      fork("u2b", "cmp", "edited q2", 10),
    ], "u2b");
    const nav = branchNavigation(session);
    expect(activeBranch(session).map((item) => item.id)).toEqual(["u1", "a1", "cmp", "u2b"]);
    expect(contextBranch(session).map((item) => item.id)).toEqual(["cmp", "a1", "u2b"]);
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
  it("keeps a session_config that predates a compaction visible", () => {
    const session = makeSession([
      configEntry("c1", null, { systemPrompt: "keep me" }),
      entry("b", "c1", "user", "two"),
      { type: "compaction", id: "cmp", parentId: "b", timestamp, summary: "sum", firstKeptEntryId: "b" },
      entry("d", "cmp", "user", "three"),
    ], "d");
    expect(sessionConfig(session)).toEqual({ systemPrompt: "keep me" });
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
  it("stays index-aligned when a compaction entry has no summary", () => {
    const session = makeSession([
      entry("u1", null, "user", "q"),
      { type: "compaction", id: "c", parentId: "u1", timestamp, firstKeptEntryId: "u1" },
      entry("u2", "c", "user", "q2"),
    ], "u2");
    const anchors = visibleMessageEntries(session);
    const visible = visibleMessages(session);
    expect(anchors.map((anchor) => anchor.id)).toEqual(["u1", "u2"]);
    expect(anchors).toHaveLength(visible.length);
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
  it("uses the latest compaction boundary for the model context but keeps the full branch for display", () => {
    const session = makeSession([entry("a", null, "user", "one"), entry("b", "a", "assistant", "two"), { type: "compaction", id: "c", parentId: "b", timestamp, summary: "sum", firstKeptEntryId: "b" }, entry("d", "c", "user", "three")], "d");
    expect(activeBranch(session).map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(contextBranch(session).map((item) => item.id)).toEqual(["c", "b", "d"]);
    const context = piContextMessages(session);
    expect((context[0] as unknown as { role: string }).role).toBe("compactionSummary");
    expect(convertPiContextToLlm(context)[0]).toMatchObject({ role: "user", content: [{ text: expect.stringContaining("sum") }] });
  });
  it("keeps full history visible around a compaction and anchors a notice at its position", () => {
    const session = makeSession([entry("a", null, "user", "one"), entry("b", "a", "assistant", "two"), { type: "compaction", id: "c", parentId: "b", timestamp, summary: "sum", firstKeptEntryId: "a" }, entry("d", "c", "user", "three")], "d");
    const visible = visibleMessages(session);
    expect(visible.map((message) => message.role)).toEqual(["user", "assistant", "notice", "user"]);
    expect(visible[2]).toEqual({ role: "notice", summary: "sum", tokensBefore: 0 });
    expect(visibleMessageEntries(session).map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
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
  it("projects prompt context (selection / chapterHref) from the entry payload", () => {
    const session = makeSession([
      { type: "message", id: "u1", parentId: null, timestamp, selection: "a quoted passage", chapterHref: "OPS/ch1.xhtml", message: { role: "user", content: "what does this mean?", timestamp: 1 } },
      entry("a1", "u1", "assistant", "answer"),
    ], "a1");
    expect(visibleMessages(session)[0]).toMatchObject({
      role: "user",
      content: "what does this mean?",
      selection: "a quoted passage",
      chapterHref: "OPS/ch1.xhtml",
    });
  });
  it("degrades gracefully for legacy user entries without context fields", () => {
    const session = makeSession([entry("u1", null, "user", "plain question")], "u1");
    expect(visibleMessages(session)).toEqual([{ role: "user", content: "plain question" }]);
  });
  it("carries stopReason only for non-normal assistant terminal states", () => {
    const session = makeSession([
      entry("u1", null, "user", "q"),
      { type: "message", id: "a1", parentId: "u1", timestamp, message: { role: "assistant", content: [{ type: "text", text: "stopped midway" }], stopReason: "aborted", timestamp: 2 } },
      { type: "message", id: "u2", parentId: "a1", timestamp, message: { role: "user", content: "again", timestamp: 3 } },
      { type: "message", id: "a2", parentId: "u2", timestamp, message: { role: "assistant", content: [{ type: "text", text: "full answer" }], stopReason: "stop", timestamp: 4 } },
    ], "a2");
    const visible = visibleMessages(session);
    expect(visible[1]).toMatchObject({ role: "assistant", content: "stopped midway", stopReason: "aborted" });
    expect(visible[3].stopReason).toBeUndefined();
  });
  it("takes the merged assistant bubble's stopReason from the run's last entry", () => {
    const session = makeSession([
      entry("u1", null, "user", "q"),
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "c1", name: "search_in_book", arguments: { queries: ["x"] } }],
          stopReason: "toolUse",
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
          content: [{ type: "text", text: "partial answer" }],
          stopReason: "aborted",
          timestamp: 3,
        },
      },
    ], "a2");
    // a1 (toolUse, a normal intermediate stop) + a2 (aborted) merge into one
    // bubble; the terminal state is the run's last entry.
    expect(visibleMessages(session)[1]).toMatchObject({ role: "assistant", content: "partial answer", stopReason: "aborted" });
  });
  it("normalizes legacy null content and rejects malformed known messages", () => {
    const normalized = makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "assistant", content: null } }], "a");
    expect((normalized.entries[0].message as { content: unknown }).content).toEqual([]);
    expect(() => makeSession([{ type: "message", id: "a", parentId: null, timestamp, message: { role: "toolResult", content: [], toolCallId: "call" } }], "a")).toThrow("Invalid Pi tool result");
  });
});

describe("contextBranch pruning", () => {
  const call = (id: string, parentId: string, callId: string, name: string, args: Record<string, unknown>) => ({ type: "message", id, parentId, timestamp, message: { role: "assistant", content: [{ type: "toolCall", id: callId, name, arguments: args }], timestamp: 1 } });
  const result = (id: string, parentId: string, callId: string, name: string, text: string) => ({ type: "message", id, parentId, timestamp, message: { role: "toolResult", toolCallId: callId, toolName: name, content: [{ type: "text", text }], isError: false, timestamp: 1 } });
  const prune = (id: string, parentId: string, throughEntryId: string) => ({ type: "context_prune", id, parentId, timestamp, throughEntryId });
  const resultText = (item: PiSessionEntry) => ((item.message as { content: Array<{ text: string }> }).content[0].text);
  const base = [
    entry("u1", null, "user", "explain chapter 3"),
    call("c1", "u1", "call1", "read_chapter", { chapterIndex: 3, part: 1 }),
    result("r1", "c1", "call1", "read_chapter", "long chapter text"),
    call("c2", "r1", "call2", "draw_mindmap", { title: "t" }),
    result("r2", "c2", "call2", "draw_mindmap", "{\"ok\":true}"),
    entry("a1", "r2", "assistant", "answer"),
    entry("u2", "a1", "user", "and chapter 4?"),
    call("c3", "u2", "call3", "read_chapter", { chapterIndex: 4 }),
    result("r3", "c3", "call3", "read_chapter", "chapter four"),
  ];

  it("replaces Book tool results up to the prune with re-read placeholders, keeping the call pairing", () => {
    const session = makeSession([...base, prune("p1", "r3", "a1")], "p1");
    const projected = contextBranch(session);
    const r1 = projected.find((item) => item.id === "r1")!;
    expect(r1.pruned).toBe(true);
    expect(r1.message).toMatchObject({ role: "toolResult", toolCallId: "call1", toolName: "read_chapter", isError: false });
    expect(resultText(r1)).toBe("[Result of read_chapter(chapterIndex=3, part=1) was cleared to save context. Call read_chapter again if you need it.]");
    // Non-Book tools and results after the prune point stay intact.
    expect(resultText(projected.find((item) => item.id === "r2")!)).toBe("{\"ok\":true}");
    expect(resultText(projected.find((item) => item.id === "r3")!)).toBe("chapter four");
  });

  it("applies only the latest prune and leaves the display branch untouched", () => {
    const session = makeSession([...base, prune("p1", "r3", "u1"), prune("p2", "p1", "r3")], "p2");
    const projected = contextBranch(session);
    expect(projected.filter((item) => item.pruned).map((item) => item.id)).toEqual(["r1", "r3"]);
    expect(resultText(activeBranch(session).find((item) => item.id === "r1")!)).toBe("long chapter text");
    expect(visibleMessages(session).map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("combines with a later compaction", () => {
    const compaction = { type: "compaction", id: "cmp", parentId: "p1", timestamp, summary: "sum", firstKeptEntryId: "u2", tokensBefore: 1 };
    const session = makeSession([...base, prune("p1", "r3", "r3"), compaction], "cmp");
    const projected = contextBranch(session);
    expect(projected.map((item) => item.id)).toEqual(["cmp", "u2", "c3", "r3", "p1"]);
    expect(projected.find((item) => item.id === "r3")!.pruned).toBe(true);
  });

  it("does not apply a prune from another branch", () => {
    const session = makeSession([...base, prune("p1", "r3", "r3"), entry("u2b", "a1", "user", "edited")], "u2b");
    expect(contextBranch(session).some((item) => item.pruned)).toBe(false);
  });

  it("sends placeholders to the model", () => {
    const session = makeSession([...base, prune("p1", "r3", "r3")], "p1");
    const toolResults = convertPiContextToLlm(piContextMessages(session)).filter((message) => message.role === "toolResult");
    expect(toolResults.map((message) => (message.content[0] as { text: string }).text)).toEqual([
      expect.stringContaining("read_chapter(chapterIndex=3, part=1)"),
      "{\"ok\":true}",
      expect.stringContaining("read_chapter(chapterIndex=4)"),
    ]);
  });
});

describe("guided sessions", () => {
  const step = (id: string, parentId: string | null, part: number) => ({
    ...entry(id, parentId, "user", `step ${part}`),
    guide: { chapterIndex: 4, part, totalParts: 3, chapterTitle: "Chapter 5" },
  });

  it("keeps the guided kind from the header and drops unknown kinds", () => {
    const guided = decodePiSession({ header: { type: "session", version: 3, id: "g", timestamp, cwd: "", kind: "guided" }, entries: [], leafId: null });
    expect(guided.header.kind).toBe("guided");
    const other = decodePiSession({ header: { type: "session", version: 3, id: "o", timestamp, cwd: "", kind: "tutor" }, entries: [], leafId: null });
    expect(other.header.kind).toBeUndefined();
  });

  it("decodes only well-formed guided steps", () => {
    expect(decodeGuide({ chapterIndex: 1, part: 0, totalParts: 1 })).toEqual({ chapterIndex: 1, part: 0, totalParts: 1 });
    expect(decodeGuide({ chapterIndex: 1, part: 1, totalParts: 1 })).toBeNull();
    expect(decodeGuide({ chapterIndex: -1, part: 0, totalParts: 1 })).toBeNull();
    expect(decodeGuide("chapter 1")).toBeNull();
    expect(decodeGuide({ chapterIndex: 1, part: 0, totalParts: 2, skim: true })).toMatchObject({ skim: true });
    expect(decodeGuide({ chapterIndex: 1, part: 0, totalParts: 2, skim: "yes" })).not.toHaveProperty("skim");
  });

  it("puts the guide on visible user messages", () => {
    const session = makeSession([step("u1", null, 0), entry("a1", "u1", "assistant", "retelling")], "a1");
    expect(visibleMessages(session)[0]).toMatchObject({ role: "user", guide: { chapterIndex: 4, part: 0 } });
  });

  it("derives the cursor from the latest step on the active branch, skipping side questions", () => {
    const entries = [
      step("u1", null, 0), entry("a1", "u1", "assistant", "part one"),
      step("u2", "a1", 1), entry("a2", "u2", "assistant", "part two"),
      entry("q1", "a2", "user", "side question"), entry("a3", "q1", "assistant", "answer"),
    ];
    expect(guideCursor(makeSession(entries, "a3"))).toMatchObject({ part: 1 });
    expect(guideCursor(makeSession(entries, "a1"))).toMatchObject({ part: 0 });
    expect(guideCursor(makeSession([entry("q", null, "user", "hi")], "q"))).toBeNull();
  });

  it("passes kind and guide through the summary", () => {
    expect(sessionSummary({ id: "g", title: "t", createdAt: timestamp, updatedAt: timestamp, kind: "guided", guide: { chapterIndex: 2, part: 0, totalParts: 1 } }))
      .toMatchObject({ kind: "guided", guide: { chapterIndex: 2, part: 0, totalParts: 1 } });
    const ordinary = sessionSummary({ id: "o", title: "t", createdAt: timestamp, updatedAt: timestamp, kind: null, guide: null });
    expect(ordinary.kind).toBeUndefined();
    expect(ordinary.guide).toBeUndefined();
  });
});
