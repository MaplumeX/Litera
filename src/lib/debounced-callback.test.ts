import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebouncedCallback } from "@/lib/debounced-callback";

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncedCallback", () => {
  it("只执行计时结束前的最后一次调用", async () => {
    vi.useFakeTimers();
    const callback = vi.fn<(value: number) => void>();
    const controller = createDebouncedCallback(callback, 500);

    controller.schedule(1);
    controller.schedule(2);
    expect(controller.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(2);
    expect(controller.pending).toBe(false);
  });

  it("flush 立即提交且只提交一次", async () => {
    vi.useFakeTimers();
    const callback = vi.fn<(value: string) => Promise<void>>(async () => {});
    const controller = createDebouncedCallback(callback, 500);

    controller.schedule("latest");
    await controller.flush();
    await vi.advanceTimersByTimeAsync(500);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("latest");
  });

  it("cancel 丢弃尚未提交的调用", async () => {
    vi.useFakeTimers();
    const callback = vi.fn<() => void>();
    const controller = createDebouncedCallback(callback, 500);

    controller.schedule();
    controller.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(callback).not.toHaveBeenCalled();
    expect(controller.pending).toBe(false);
  });

  it("StrictMode 重复清理保持幂等且不执行待处理调用", async () => {
    vi.useFakeTimers();
    const callback = vi.fn<() => void>();
    const controller = createDebouncedCallback(callback, 500);

    controller.schedule();
    controller.cancel();
    controller.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(callback).not.toHaveBeenCalled();
    expect(controller.pending).toBe(false);
  });

  it("flush 等待异步持久化完成", async () => {
    let finish: (() => void) | undefined;
    const callback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = createDebouncedCallback(callback, 500);
    controller.schedule();

    const flushed = controller.flush();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    finish?.();
    await expect(flushed).resolves.toBeUndefined();
  });

  it("flush 向调用方传播持久化错误", async () => {
    const error = new Error("storage failed");
    const controller = createDebouncedCallback(
      async () => {
        throw error;
      },
      500,
    );
    controller.schedule();

    await expect(controller.flush()).rejects.toBe(error);
  });
});
