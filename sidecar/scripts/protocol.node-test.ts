import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decodeCommand, decodeEvent, parseCommandLine, ProtocolDecodeError } from "../protocol.ts";

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "protocol", "agent-protocol.jsonl");

test("shared protocol fixtures decode and round-trip", async () => {
  const lines = (await readFile(fixturePath, "utf8")).trim().split("\n");
  for (const line of lines) {
    const fixture = JSON.parse(line) as { direction: "command" | "event"; message: unknown };
    const decoded = fixture.direction === "command"
      ? decodeCommand(fixture.message)
      : decodeEvent(fixture.message);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded)), fixture.message);
  }
});

test("prompt context decodes chapterHref and rejects a non-string locator", () => {
  const command = decodeCommand({
    protocolVersion: 1,
    type: "prompt",
    requestId: "r",
    promptId: "p",
    bookId: "b",
    text: "hello",
    context: { chapterHref: "OEBPS/ch1.xhtml#start" },
  });
  if (command.type !== "prompt") throw new Error("expected prompt");
  assert.equal(command.context?.chapterHref, "OEBPS/ch1.xhtml#start");
  assert.equal(command.context && "chapterIndex" in command.context, false);

  assert.throws(
    () => decodeCommand({
      protocolVersion: 1,
      type: "prompt",
      requestId: "r",
      promptId: "p",
      bookId: "b",
      text: "hello",
      context: { chapterHref: 3 },
    }),
    ProtocolDecodeError,
  );
});

test("command decoder rejects missing correlation and oversized prompts", () => {
  assert.throws(
    () => decodeCommand({ protocolVersion: 1, type: "prompt", requestId: "r", bookId: "b", text: "x" }),
    ProtocolDecodeError,
  );
  assert.throws(
    () => parseCommandLine(JSON.stringify({
      protocolVersion: 1,
      type: "prompt",
      requestId: "r",
      promptId: "p",
      bookId: "b",
      text: "x".repeat(64 * 1024 + 1),
    })),
    ProtocolDecodeError,
  );
});

test("event decoder requires positive monotonic-compatible seq and toolCallId", () => {
  assert.throws(
    () => decodeEvent({ protocolVersion: 1, seq: 0, type: "ready" }),
    ProtocolDecodeError,
  );
  assert.throws(
    () => decodeEvent({
      protocolVersion: 1,
      seq: 1,
      type: "tool_end",
      bookId: "b",
      sessionId: "s",
      promptId: "p",
      result: null,
      isError: false,
    }),
    ProtocolDecodeError,
  );
});

test("event decoder accepts tool-only assistant history and validates nested ids", () => {
  const event = decodeEvent({
    protocolVersion: 1,
    seq: 1,
    type: "session_switched",
    requestId: "r",
    bookId: "b",
    sessionId: "s",
    messages: [{
      role: "assistant",
      content: "",
      toolCalls: [{ toolCallId: "tool-1", tool: "read_chapter", params: {}, done: false }],
    }],
  });
  assert.equal(event.type, "session_switched");
  assert.equal(event.messages[0].content, "");

  assert.throws(
    () => decodeEvent({
      protocolVersion: 1,
      seq: 2,
      type: "sessions_list",
      requestId: "r",
      bookId: "b",
      sessions: [{ id: "x".repeat(129), title: "title", createdAt: "1", updatedAt: "1" }],
    }),
    ProtocolDecodeError,
  );
});
