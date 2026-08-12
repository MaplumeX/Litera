import assert from "node:assert/strict";
import test from "node:test";
import {
  BookLoadGate,
  BoundedCancellationSet,
  BoundedOutputQueue,
  SerialDispatcher,
  SupersedingResource,
} from "../dispatcher.ts";

test("state commands execute serially while bypass controls run immediately", async () => {
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const dispatcher = new SerialDispatcher((error) => { throw error; });
  dispatcher.enqueue(async () => {
    order.push("first-start");
    await firstBlocked;
    order.push("first-end");
  });
  dispatcher.enqueue(async () => { order.push("second"); });
  dispatcher.bypass(async () => { order.push("abort"); });
  await Promise.resolve();
  assert.deepEqual([...order].sort(), ["abort", "first-start"]);
  assert.equal(order.includes("second"), false);
  releaseFirst?.();
  await dispatcher.idle();
  assert.equal(order.indexOf("abort") < order.indexOf("first-end"), true);
  assert.deepEqual(order.slice(-2), ["first-end", "second"]);
});

test("a stale slow book load cannot overwrite a newer book", () => {
  const gate = new BookLoadGate();
  const generationA = gate.begin("book-a");
  const generationB = gate.begin("book-b");
  assert.equal(gate.accepts(generationA, "book-a"), false);
  assert.equal(gate.accepts(generationB, "book-b"), true);
});

test("a session-bound tool loses access as soon as another book generation begins", () => {
  const gate = new BookLoadGate();
  const generationA = gate.begin("book-a");
  const capturedAccess = () => gate.accepts(generationA, "book-a");
  assert.equal(capturedAccess(), true);
  gate.begin("book-b");
  assert.equal(capturedAccess(), false);
});

test("serialized dispatcher rejects commands when its bounded queue is full", async () => {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const dispatcher = new SerialDispatcher((error) => { throw error; }, 1);
  assert.equal(dispatcher.enqueue(async () => blocked), true);
  assert.equal(dispatcher.enqueue(async () => undefined), false);
  release?.();
  await dispatcher.idle();
});

test("an abort arriving before prompt dispatch cancels that queued prompt exactly once", () => {
  const cancellations = new BoundedCancellationSet();
  cancellations.add("prompt-queued");
  assert.equal(cancellations.consume("prompt-queued"), true);
  assert.equal(cancellations.consume("prompt-queued"), false);
});

test("replacing a worker exposes the new worker without awaiting a slow retirement", async () => {
  let nextId = 0;
  let releaseOld: (() => void) | undefined;
  const oldTermination = new Promise<void>((resolve) => { releaseOld = resolve; });
  const terminated: number[] = [];
  const resources = new SupersedingResource(
    () => {
      const id = ++nextId;
      return {
        id,
        terminate: async () => {
          terminated.push(id);
          if (id === 1) await oldTermination;
        },
      };
    },
    (error) => { throw error; },
  );

  assert.equal(resources.replace().id, 1);
  assert.equal(resources.replace().id, 2);
  assert.equal(resources.current()?.id, 2);
  await Promise.resolve();
  assert.deepEqual(terminated, [1]);

  releaseOld?.();
  await resources.shutdown();
  assert.deepEqual(terminated, [1, 2]);
});

test("stdout backpressure is ordered and bounded outside the stream buffer", () => {
  const written: string[] = [];
  let drain: (() => void) | undefined;
  let acceptWrites = false;
  let overflowed = false;
  const output = new BoundedOutputQueue(
    {
      write: (frame) => {
        written.push(frame);
        return acceptWrites;
      },
      once: (_event, listener) => { drain = listener; },
    },
    () => { overflowed = true; },
    2,
    16,
  );

  assert.equal(output.write("first"), true);
  assert.equal(output.write("second"), true);
  assert.equal(output.write("third"), true);
  acceptWrites = true;
  drain?.();
  assert.deepEqual(written, ["first", "second", "third"]);
  assert.equal(overflowed, false);

  acceptWrites = false;
  assert.equal(output.write("block"), true);
  assert.equal(output.write("one"), true);
  assert.equal(output.write("two"), true);
  assert.equal(output.write("overflow"), false);
  assert.equal(overflowed, true);
});
