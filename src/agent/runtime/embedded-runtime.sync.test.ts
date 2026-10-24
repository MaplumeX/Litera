import { describe, expect, it } from "vitest";
import { LiteraAgentRuntime } from "./embedded-runtime";
import type { BookContentPort } from "@/agent/book/book-content";
import type { SessionPort } from "@/agent/sessions/session-port";
import type { DecodedPiSession } from "@/agent/sessions/pi-session";
import type { AgentEvent } from "@/types/agent";

function session(entries: DecodedPiSession["entries"]): DecodedPiSession {
  return {
    header: { type: "session", version: 3, id: "session-1", timestamp: "2026-10-01T00:00:00Z", cwd: "" },
    entries,
    leafId: entries.at(-1)?.id ?? null,
  };
}

const first = { type: "message", id: "u1", parentId: null, timestamp: "2026-10-01T00:00:01Z", message: { role: "user", content: "first question", timestamp: 1 } } as const;
const second = { type: "message", id: "u2", parentId: "u1", timestamp: "2026-10-01T00:00:02Z", message: { role: "user", content: "from another device", timestamp: 2 } } as const;

async function harness() {
  const events: AgentEvent[] = [];
  let stored = session([first]);
  let lists = 0;
  let deleted = false;
  const sessions: SessionPort = {
    create: async () => stored,
    list: async () => {
      lists += 1;
      return deleted ? [] : [{ id: "session-1", title: "first question", createdAt: "", updatedAt: "" }];
    },
    load: async () => {
      if (deleted) throw new Error("Unknown session");
      return stored;
    },
    setLeaf: async () => stored,
    delete: async () => {},
    append: async () => null,
  };
  const book: BookContentPort = {
    open: async () => {},
    metadata: async () => ({ title: "T", author: "A", language: "en", totalChapters: 1 }),
    toc: async () => [],
    readChapter: async () => ({ chapterIndex: 0, chapterNumber: 1, part: 0, totalParts: 1, text: "chapter" }),
    search: async () => [],
    close: () => {},
  };
  const runtime = new LiteraAgentRuntime({ sessions, book });
  runtime.subscribe((event) => events.push(event));
  await runtime.openBook("book", new ArrayBuffer(1));
  await runtime.switchSession("session-1");
  events.length = 0;
  return {
    runtime,
    events,
    lists: () => lists,
    setStored: (next: DecodedPiSession) => {
      stored = next;
    },
    deleteElsewhere: () => {
      deleted = true;
    },
  };
}

describe("LiteraAgentRuntime after a Sync pass", () => {
  it("reloads the open session when another device added messages", async () => {
    const { runtime, events, setStored } = await harness();
    setStored(session([first, second]));

    await runtime.refreshAfterSync();

    const switched = events.find((event) => event.type === "session_switched");
    expect(switched?.type === "session_switched" && switched.messages).toEqual([
      { role: "user", content: "first question" },
      { role: "user", content: "from another device" },
    ]);
  });

  it("refreshes the session list but leaves an unchanged session alone", async () => {
    const { runtime, events, lists } = await harness();
    const before = lists();

    await runtime.refreshAfterSync();

    expect(lists()).toBe(before + 1);
    expect(events.some((event) => event.type === "session_switched")).toBe(false);
  });

  it("closes the open session when another device deleted it", async () => {
    const { runtime, events, deleteElsewhere } = await harness();
    deleteElsewhere();

    await runtime.refreshAfterSync();

    expect(events.find((event) => event.type === "session_deleted")).toMatchObject({
      bookId: "book",
      sessionId: "session-1",
    });
  });
});
