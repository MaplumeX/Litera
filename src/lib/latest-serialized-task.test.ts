import { describe, expect, it } from "vitest";
import { createLatestSerializedTaskController } from "@/lib/latest-serialized-task";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("latest serialized task controller", () => {
  it("serializes side effects and only applies the newest A/B result", async () => {
    const controller = createLatestSerializedTaskController();
    const a = deferred<string>();
    const b = deferred<string>();
    const started: string[] = [];
    const applied: string[] = [];

    const requestA = controller.run(async () => {
      started.push("A");
      return a.promise;
    });
    await Promise.resolve();
    const requestB = controller.run(async () => {
      started.push("B");
      return b.promise;
    });

    expect(started).toEqual(["A"]);
    a.resolve("A");
    const resultA = await requestA.promise;
    if (resultA.status === "completed") applied.push(resultA.value);
    expect(resultA.status).toBe("stale");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["A", "B"]);

    b.resolve("B");
    const resultB = await requestB.promise;
    if (resultB.status === "completed") applied.push(resultB.value);

    expect(applied).toEqual(["B"]);
    expect(requestA.isLatest()).toBe(false);
    expect(requestB.isLatest()).toBe(true);
  });

  it("suppresses a stale failure but propagates the latest failure", async () => {
    const controller = createLatestSerializedTaskController();
    const stale = deferred<void>();
    const requestA = controller.run(() => stale.promise);
    await Promise.resolve();
    const requestB = controller.run(async () => {
      throw new Error("latest failed");
    });

    stale.reject(new Error("stale failed"));
    await expect(requestA.promise).resolves.toEqual({ status: "stale" });
    await expect(requestB.promise).rejects.toThrow("latest failed");
  });
});
