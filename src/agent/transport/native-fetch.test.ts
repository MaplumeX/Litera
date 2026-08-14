import { describe, expect, it, vi } from "vitest";
import { createGuardedNativeFetch } from "./native-fetch";

describe("createGuardedNativeFetch", () => {
  it("uses the native adapter for the configured origin and disables redirects", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    await expect(guarded("https://models.example.test/v1/chat/completions", {
      method: "POST",
    })).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://models.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST", maxRedirections: 0 }),
    );
  });

  it("rejects another origin before invoking the native adapter", async () => {
    const fetchImpl = vi.fn();
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    await expect(guarded("https://evil.example/v1/chat/completions"))
      .rejects.toThrow("不在当前提供商允许范围内");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-http provider URLs", () => {
    expect(() => createGuardedNativeFetch({ baseUrl: "file:///tmp/key" }))
      .toThrow("必须使用 HTTP(S)");
  });

  it("does not echo request secrets when native fetch fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl,
    });

    const error = await guarded("https://models.example.test/v1/chat/completions", {
      headers: { Authorization: "Bearer secret-key" },
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain("模型网络请求失败");
    expect(String(error)).not.toContain("secret-key");
  });

  it("redacts malformed request URLs", async () => {
    const guarded = createGuardedNativeFetch({
      baseUrl: "https://models.example.test/v1",
      fetchImpl: vi.fn(),
    });
    const error = await guarded("not a url?api_key=secret-key").catch((caught: unknown) => caught);
    expect(String(error)).toContain("请求地址无效");
    expect(String(error)).not.toContain("secret-key");
  });
});
