import assert from "node:assert/strict";
import test from "node:test";
import { visibleMessageEntries } from "../visible-branch.ts";

test("visibleMessageEntries keeps getBranch root-to-leaf order", () => {
  const branch = [
    { type: "custom_message", customType: "bookSnapshot", id: "snap" },
    { type: "message", message: { role: "user" }, id: "u1" },
    { type: "message", message: { role: "assistant" }, id: "a1" },
    { type: "custom_message", customType: "readingContext", id: "ctx" },
    { type: "message", message: { role: "user" }, id: "u2" },
    { type: "message", message: { role: "assistant" }, id: "a2" },
  ];
  const visible = visibleMessageEntries(branch);
  assert.deepEqual(visible.map((entry) => entry.id), ["u1", "a1", "u2", "a2"]);
  assert.equal(visible[0]?.message?.role, "user");
  assert.equal(visible[2]?.message?.role, "user");
});
